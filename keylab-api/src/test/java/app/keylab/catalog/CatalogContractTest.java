package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import app.keylab.shared.security.Roles;
import app.keylab.sound.SoundProcessed;
import app.keylab.sound.SoundProcessed.Outcome;
import app.keylab.sound.SoundProcessed.Stroke;
import app.keylab.sound.SoundProcessed.Variant;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.node.StringNode;

/**
 * KL-R1 safety net: the exact responses of the catalog endpoints (CAT-01 to
 * CAT-03, ADM-02, ADM-03), status, the headers a client reads and the whole
 * body, compared with a recording made before the refactor. Error arrays are
 * compared in order. Ids, times and the per-run name token are masked.
 *
 * <p>Record again (only for an intended API change) with
 * {@code KEYLAB_CONTRACT_RECORD=1 ./gradlew :keylab-api:test --tests '*CatalogContractTest'}.
 */
class CatalogContractTest extends IntegrationTest {

    static final Path GOLDEN = Path.of("src/test/resources/app/keylab/catalog/catalog-contract.json");
    static final String SWITCHES = "/v1/admin/switches";
    static final String LIBRARY = "/v1/switches";
    static final String MERGE_PATCH = "application/merge-patch+json";
    static final Pattern UUID_TEXT = Pattern
        .compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    static final Pattern INSTANT_TEXT = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z");

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);
    /** Lower case letters only, so it reads the same in a name and in a slug. */
    final String run = "zq" + new java.util.Random().ints(6, 'a', 'z' + 1)
        .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();

    @Autowired
    ApplicationEventPublisher events;

    @Autowired
    TransactionTemplate tx;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    final ObjectNode cases = JsonMapper.builder().build().createObjectNode();

    @Test
    void catalogResponsesMatchTheRecording() throws Exception {
        // --- ADM-02 create: every kind of field error, in order ---------------------
        record("create invalid fields", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("""
                    { "name": "", "brand": 42, "type": "squishy", "profile": "loud", "stemColor": "red",
                      "forceG": "62g", "actuationMm": 4, "travelMm": 3.8, "bottomOutG": 300,
                      "spring": "%s", "housing": 5,
                      "forceCurve": [ { "travelMm": 0, "forceG": 0 }, { "travelMm": 0, "forceG": 5 },
                        { "travelMm": 9, "forceG": "a" }, { "forceG": 1 }, 7,
                        { "travelMm": 1, "forceG": 300, "stroke": "up" }, { "travelMm": "x" },
                        { "travelMm": 0.004, "forceG": 0.04, "stroke": null } ],
                      "photoUploadId": "nope" }
                    """.formatted("s".repeat(41))));
        record("create not an object", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("[1]"));
        record("create empty", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON).content("{}"));
        StringBuilder points = new StringBuilder();
        for (int i = 0; i < 51; i++) {
            points.append(i == 0 ? "" : ",").append("{ \"travelMm\": 0.0").append(i % 10).append(", \"forceG\": 1 }");
        }
        record("create long name, too many points", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("{ \"name\": \"" + "n".repeat(61) + "\", \"type\": \"linear\", \"forceG\": 9.94, "
                    + "\"travelMm\": 6.004, \"actuationMm\": 0.096, \"forceCurve\": [" + points + "] }"));
        record("create curve not a list", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("{ \"name\": \"x\", \"type\": \"linear\", \"forceCurve\": \"x\", \"stemColor\": 5 }"));
        record("create unknown photo upload", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("{ \"name\": \"x\", \"type\": \"linear\", \"photoUploadId\": \"" + UUID.randomUUID() + "\" }"));

        // --- ADM-02 create, read, edit, delete --------------------------------------
        MockHttpServletResponse created = record("create", asEditor(post(SWITCHES))
            .contentType(MediaType.APPLICATION_JSON).content("""
                    { "name": "Coral %s", "brand": "Clack Works", "type": "tactile", "profile": "poppy",
                      "stemColor": "#f16b53", "forceG": 62.0, "actuationMm": 2.0, "travelMm": 3.8,
                      "bottomOutG": 92.25, "spring": " 18 ", "housing": "PC", "photoUploadId": null,
                      "forceCurve": [ { "travelMm": 3.8, "forceG": 92 }, { "travelMm": 0, "forceG": 0 },
                        { "travelMm": 2.0, "forceG": 55, "stroke": "release" },
                        { "travelMm": 2.0, "forceG": 62, "stroke": "press" } ] }
                    """.formatted(run)));
        String location = created.getHeader("Location");
        UUID id = UUID.fromString(location.substring(location.lastIndexOf('/') + 1));
        record("create again, slug taken", asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
            .content("{ \"name\": \"Coral " + run + "\", \"type\": \"linear\" }"));
        record("get", asEditor(get(location)));
        record("get unknown", asEditor(get(SWITCHES + "/" + UUID.randomUUID())));
        record("get malformed id", asEditor(get(SWITCHES + "/not-a-uuid")));
        record("patch without If-Match", asEditor(patch(location)).contentType(MERGE_PATCH).content("{}"));
        record("patch stale", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"9\"")
            .content("{}"));
        record("patch weak tag", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "W/\"1\"")
            .content("{}"));
        record("patch unknown, stale", asEditor(patch(SWITCHES + "/" + UUID.randomUUID())).contentType(MERGE_PATCH)
            .header("If-Match", "\"1\"").content("{ \"name\": \"\" }"));
        record("patch stale and invalid", asEditor(patch(location)).contentType(MERGE_PATCH)
            .header("If-Match", "\"7\"").content("{ \"name\": \"\" }"));
        record("patch invalid merge", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
            .content("{ \"travelMm\": 1.5, \"type\": null }"));
        record("patch not an object", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
            .content("[]"));
        record("patch rename", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "*")
            .content("{ \"name\": \"Coral %s Pro\", \"brand\": null, \"forceCurve\": [] }".formatted(run)));
        record("patch no change", asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\", \"2\"")
            .content("{}"));
        record("admin list", asEditor(get(SWITCHES)).param("q", run).param("page_size", "1"));
        record("admin list bad token", asEditor(get(SWITCHES)).param("page_token", "garbage"));
        record("delete without If-Match", asEditor(delete(location)));
        record("delete stale", asEditor(delete(location)).header("If-Match", "\"1\""));

        // --- ADM-03 publish ---------------------------------------------------------
        record("publish without sounds", publish(id, "{ \"markNew\": true }"));
        record("publish unknown", publish(UUID.randomUUID(), "{}"));
        record("unpublish a draft", asEditor(delete(SWITCHES + "/" + id + "/publication")));
        record("get after draft unpublish", asEditor(get(location)));
        sound(id, Variant.stock, Stroke.press, Instant.parse("2026-11-15T10:00:00Z"));
        sound(id, Variant.lubed, Stroke.press, Instant.parse("2026-11-15T10:00:00Z"));
        sound(id, Variant.stock, Stroke.release, Instant.parse("2026-11-15T10:01:00Z"));
        await(() -> "recorded".equals(jdbc.sql("SELECT sound_status FROM catalog.switches WHERE id = ?").param(id)
            .query(String.class).single()));
        record("publish, new", publish(id, "{ \"markNew\": true }"));
        record("delete published", asEditor(delete(location)).header("If-Match", "*"));
        record("patch published rename", asEditor(patch(location)).contentType(MERGE_PATCH)
            .header("If-Match", "\"4\"").content("{ \"name\": \"Coral %s Max\" }".formatted(run)));
        String slug = json.readTree(asEditorGet(location)).get("slug").asString();

        // --- CAT-01 to CAT-03 ---------------------------------------------------------
        record("library", get(LIBRARY).param("q", run));
        record("library by force", get(LIBRARY).param("q", run).param("sort", "force").param("is_new", "true")
            .param("force_min", "1").param("force_max", "100").param("type", "Tactile").param("sound", "recorded"));
        record("library bad type", get(LIBRARY).param("type", "squishy"));
        record("library bad profile", get(LIBRARY).param("profile", "loud"));
        record("library bad sound", get(LIBRARY).param("sound", "maybe"));
        record("library bad sort", get(LIBRARY).param("sort", "name"));
        record("library bad is_new", get(LIBRARY).param("is_new", "yes"));
        record("library bad force", get(LIBRARY).param("force_min", "abc"));
        record("library force out of range", get(LIBRARY).param("force_max", "1001"));
        record("library long q", get(LIBRARY).param("q", "q".repeat(61)));
        record("library bad token", get(LIBRARY).param("page_token", "garbage"));
        record("library bad page size", get(LIBRARY).param("page_size", "0"));
        record("detail", get(LIBRARY + "/" + slug).param("include", "sounds"));
        record("detail bad include", get(LIBRARY + "/" + slug).param("include", "sounds,photos"));
        record("detail unknown", get(LIBRARY + "/no-such-" + run));
        record("sounds", get(LIBRARY + "/" + slug + "/sounds"));
        record("related bad page size", get(LIBRARY + "/" + slug + "/related").param("page_size", "500"));

        // --- ADM-03 pull, publish again -----------------------------------------------
        record("unpublish", asEditor(delete(SWITCHES + "/" + id + "/publication")));
        record("detail after unpublish", get(LIBRARY + "/" + slug));
        record("get hidden", asEditor(get(location)));
        record("unpublish hidden", asEditor(delete(SWITCHES + "/" + id + "/publication")));
        record("publish again, not new", publish(id, "{ \"markNew\": false }"));
        record("publish no body", asEditor(post(SWITCHES + "/" + id + "/publication"))
            .contentType(MediaType.APPLICATION_JSON));

        String actual = json.writerWithDefaultPrettyPrinter().writeValueAsString(cases) + "\n";
        if (System.getenv("KEYLAB_CONTRACT_RECORD") != null) {
            Files.createDirectories(GOLDEN.getParent());
            Files.writeString(GOLDEN, actual, StandardCharsets.UTF_8);
        }
        assertThat(actual).isEqualTo(Files.readString(GOLDEN, StandardCharsets.UTF_8));
    }

    // --- Recording ------------------------------------------------------------------------

    MockHttpServletResponse record(String name, MockHttpServletRequestBuilder request) throws Exception {
        MockHttpServletResponse response = mvc.perform(request).andReturn().getResponse();
        ObjectNode entry = cases.putObject(name);
        entry.put("status", response.getStatus());
        for (String header : List.of("Content-Type", "ETag", "Location", "Cache-Control")) {
            String value = response.getHeader(header);
            // The public ETag is a hash of the body, which holds ids; the body itself is compared.
            if (value != null && !(header.equals("ETag") && !name.startsWith("get") && !name.startsWith("create")
                    && !name.startsWith("patch") && !name.startsWith("publish"))) {
                entry.put(header, mask(value));
            }
        }
        String body = response.getContentAsString(StandardCharsets.UTF_8);
        if (!body.isEmpty()) {
            entry.set("body", maskTree(json.readTree(body)));
        }
        return response;
    }

    String mask(String text) {
        String masked = UUID_TEXT.matcher(text).replaceAll("<uuid>");
        masked = INSTANT_TEXT.matcher(masked).replaceAll("<instant>");
        return masked.replace(run, "<run>");
    }

    JsonNode maskTree(JsonNode node) {
        if (node.isString()) {
            return StringNode.valueOf(mask(node.stringValue()));
        }
        if (node.isArray()) {
            ArrayNode out = JsonMapper.builder().build().createArrayNode();
            node.forEach((item) -> out.add(maskTree(item)));
            return out;
        }
        if (node.isObject()) {
            ObjectNode out = JsonMapper.builder().build().createObjectNode();
            for (Map.Entry<String, JsonNode> field : node.properties()) {
                // A page token encodes the last row's id; whether there is one is what counts.
                boolean token = field.getKey().equals("nextPageToken") && field.getValue().isString();
                out.set(field.getKey(), token ? StringNode.valueOf("<token>") : maskTree(field.getValue()));
            }
            return out;
        }
        return node;
    }

    // --- Helpers --------------------------------------------------------------------------

    MockHttpServletRequestBuilder asEditor(MockHttpServletRequestBuilder request) {
        return bearer(request, editor);
    }

    String asEditorGet(String location) throws Exception {
        return mvc.perform(asEditor(get(location))).andReturn().getResponse().getContentAsString();
    }

    MockHttpServletRequestBuilder publish(UUID id, String body) {
        return asEditor(post(SWITCHES + "/" + id + "/publication")).contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }

    void sound(UUID switchId, Variant variant, Stroke stroke, Instant at) {
        UUID recordingId = UUID.randomUUID();
        SoundProcessed event = new SoundProcessed(recordingId, switchId, variant, stroke, Outcome.ready,
                "https://cdn.keylab.test/assets/sounds/" + recordingId + ".opus", 180, new BigDecimal("-14.50"),
                new ArrayList<>(List.of(0.1, 0.8, 0.3)), at);
        tx.executeWithoutResult((status) -> events.publishEvent(event));
    }

    static void await(Supplier<Boolean> condition) {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(10));
        while (!condition.get()) {
            if (Instant.now().isAfter(deadline)) {
                throw new AssertionError("Timed out waiting for the SoundProcessed listener");
            }
            try {
                Thread.sleep(25);
            }
            catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new AssertionError(ex);
            }
        }
    }
}
