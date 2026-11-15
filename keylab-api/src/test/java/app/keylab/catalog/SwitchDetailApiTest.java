package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-04: one published switch with its specs and force curve (CAT-02), its
 * recordings by variant and stroke (CAT-03), and the switches that sound like
 * it (CAT-04). Guests may read all three; drafts and pulled switches are not
 * there.
 */
class SwitchDetailApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String LIBRARY = "/v1/switches";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    @Test
    void aGuestReadsSpecsCurveSoundsAndRelatedOfAPublishedSwitch() throws Exception {
        String brand = "Detail" + UUID.randomUUID().toString().substring(0, 8);
        Created milk = create(brand, "Milk Yellow", "linear", "deep", 50, true);
        recording(milk.id(), "stock", "press");
        recording(milk.id(), "stock", "release");
        recording(milk.id(), "lubed", "press");

        mvc.perform(get(LIBRARY + "/" + milk.slug()))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "max-age=300, public"))
            .andExpect(header().exists("ETag"))
            .andExpect(jsonPath("$.name").value("Milk Yellow " + brand))
            .andExpect(jsonPath("$.spring").value("18 mm gold"))
            .andExpect(jsonPath("$.housing").value("milky"))
            .andExpect(jsonPath("$.bottomOutG").value(62))
            .andExpect(jsonPath("$.forceCurve.length()").value(3))
            .andExpect(jsonPath("$.forceCurve[0].stroke").value("press"))
            .andExpect(jsonPath("$.soundSummary.profile").value("deep"))
            .andExpect(jsonPath("$.soundSummary.word").value("Deep & rounded"))
            .andExpect(jsonPath("$.sounds").doesNotExist())
            .andExpect(jsonPath("$.related").doesNotExist());

        mvc.perform(get(LIBRARY + "/" + milk.slug()).param("include", "sounds, related"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sounds.length()").value(3))
            .andExpect(jsonPath("$.related").isArray());

        // CAT-03: stock, then lubed; press before release.
        mvc.perform(get(LIBRARY + "/" + milk.slug() + "/sounds"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "max-age=300, public"))
            .andExpect(jsonPath("$.soundStatus").value("recorded"))
            .andExpect(jsonPath("$.data.length()").value(3))
            .andExpect(jsonPath("$.data[0].variant").value("stock"))
            .andExpect(jsonPath("$.data[0].stroke").value("press"))
            .andExpect(jsonPath("$.data[1].stroke").value("release"))
            .andExpect(jsonPath("$.data[2].variant").value("lubed"))
            .andExpect(jsonPath("$.data[0].url").value("https://cdn.keylab.test/stock-press.opus"))
            .andExpect(jsonPath("$.data[0].peaks.length()").value(3));

        // A matching ETag is answered with 304.
        String etag = mvc.perform(get(LIBRARY + "/" + milk.slug())).andReturn().getResponse().getHeader("ETag");
        mvc.perform(get(LIBRARY + "/" + milk.slug()).header("If-None-Match", etag))
            .andExpect(status().isNotModified());
    }

    @Test
    void relatedListsTheClosestSoundingSwitchesFirstAndNeverItself() throws Exception {
        // Forces far from every other test's switches, so the nearest ones are these.
        String brand = "Near" + UUID.randomUUID().toString().substring(0, 8);
        Created target = create(brand, "Target", "linear", "deep", 146, true);
        Created close = create(brand, "Close", "linear", "deep", 147, true);
        Created further = create(brand, "Further", "linear", "deep", 140, true);
        Created otherType = create(brand, "Other type", "tactile", "deep", 146, true);
        create(brand, "Fourth", "clicky", "clacky", 120, true);
        Created draft = create(brand, "Draft", "linear", "deep", 146, false);

        List<String> top = ids(related(target.slug(), "2"));
        assertThat(top).containsExactly(close.id(), further.id());

        JsonNode all = related(target.slug(), "100");
        List<String> every = ids(all);
        assertThat(every).doesNotContain(target.id(), draft.id());
        // Same profile and type beat the same force with another type.
        assertThat(every.indexOf(otherType.id())).isGreaterThan(every.indexOf(further.id()));
        assertThat(all.at("/page/pageSize").asInt()).isEqualTo(100);
        assertThat(all.at("/page/nextPageToken").isNull()).isTrue();

        // Four by default, the "Sounds similar" row.
        assertThat(related(target.slug(), null).get("data")).hasSize(4);

        mvc.perform(get(LIBRARY + "/" + target.slug() + "/related").param("page_size", "101"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_size"));
    }

    @Test
    void draftsPulledSwitchesAndUnknownIncludesAreRefused() throws Exception {
        String brand = "Gone" + UUID.randomUUID().toString().substring(0, 8);
        Created draft = create(brand, "Draft", "linear", "deep", 50, false);
        Created pulled = create(brand, "Pulled", "linear", "deep", 50, true);
        mvc.perform(bearer(delete(SWITCHES + "/" + pulled.id() + "/publication"), editor))
            .andExpect(status().isNoContent());

        for (String slug : List.of(draft.slug(), pulled.slug(), "no-such-switch")) {
            for (String path : List.of("", "/sounds", "/related")) {
                mvc.perform(get(LIBRARY + "/" + slug + path))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("switch_not_found"));
            }
        }

        Created live = create(brand, "Live", "linear", "deep", 50, true);
        mvc.perform(get(LIBRARY + "/" + live.slug()).param("include", "sounds,reviews"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_parameter"));
        // A published switch with no recordings: an empty list, not an error.
        jdbc.sql("UPDATE catalog.switches SET sound_status = 'missing' WHERE id = ?")
            .param(UUID.fromString(live.id())).update();
        mvc.perform(get(LIBRARY + "/" + live.slug() + "/sounds"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.soundStatus").value("missing"))
            .andExpect(jsonPath("$.data.length()").value(0));
    }

    // --- Helpers ------------------------------------------------------------------------

    record Created(String id, String slug) {
    }

    /** A switch with full specs; published when asked, its sound status set directly to keep this fast. */
    Created create(String brand, String name, String type, String profile, int force, boolean publish)
            throws Exception {
        String body = """
                { "name": "%s %s", "brand": "%s", "type": "%s", "profile": "%s", "stemColor": "#E8C25A",
                  "forceG": %d, "actuationMm": 2.0, "travelMm": 4.0, "bottomOutG": 62, "spring": "18 mm gold",
                  "housing": "milky",
                  "forceCurve": [ { "travelMm": 0, "forceG": 0 }, { "travelMm": 2.0, "forceG": 50 },
                                  { "travelMm": 4.0, "forceG": 62 } ] }
                """.formatted(name, brand, brand, type, profile, force);
        MvcResult created = mvc
            .perform(bearer(post(SWITCHES), editor).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn();
        JsonNode sw = json.readTree(created.getResponse().getContentAsString());
        String id = sw.get("id").asString();
        if (publish) {
            jdbc.sql("UPDATE catalog.switches SET sound_status = 'recorded' WHERE id = ?").param(UUID.fromString(id))
                .update();
            mvc.perform(bearer(post(SWITCHES + "/" + id + "/publication"), editor)
                    .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        }
        return new Created(id, sw.get("slug").asString());
    }

    void recording(String switchId, String variant, String stroke) {
        jdbc.sql("""
                INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms,
                  loudness_lufs, peaks, processed_at)
                VALUES (?, ?, ?, ?, ?, 180, -14.5, '[0.1,0.8,0.3]', now())
                """)
            .params(UUID.fromString(switchId), variant, stroke, UUID.randomUUID(),
                    "https://cdn.keylab.test/" + variant + "-" + stroke + ".opus")
            .update();
    }

    JsonNode related(String slug, String pageSize) throws Exception {
        MockHttpServletRequestBuilder request = get(LIBRARY + "/" + slug + "/related");
        if (pageSize != null) {
            request.param("page_size", pageSize);
        }
        MvcResult result = mvc.perform(request).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    static List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.get("data").forEach((sw) -> ids.add(sw.get("id").asString()));
        return ids;
    }
}
