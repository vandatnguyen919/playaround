package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-39 through the real filter chain, Postgres and the event publication
 * registry: publishing waits for the stock press and release sounds, the
 * SoundProcessed event moves the switch's sound status, and a published
 * switch shows in the public library (CAT-01), cached for one window, with
 * the New sticker when chosen. Drafts and pulled switches never show.
 */
class PublishSwitchApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String LIBRARY = "/v1/switches";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);
    final String viewer = StubJwks.token(Roles.USER, Roles.VIEWER);

    @Autowired
    ApplicationEventPublisher events;

    @Autowired
    TransactionTemplate tx;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    // --- Publish only once the stock sounds exist -------------------------------------

    @Test
    void publishingIsRefusedUntilStockPressAndReleaseAreReady() throws Exception {
        String name = unique("Coral Pop");
        UUID id = createDraft(name);

        publish(id, true).andExpect(status().isConflict())
            .andExpect(header().string("Content-Type", containsString("application/problem+json")))
            .andExpect(jsonPath("$.code").value("missing_required_sounds"));

        // Press only: still not enough. Lubed sounds do not count for publishing.
        sound(id, Variant.stock, Stroke.press, Outcome.ready, Instant.parse("2026-11-15T10:00:00Z"));
        sound(id, Variant.lubed, Stroke.release, Outcome.ready, Instant.parse("2026-11-15T10:00:00Z"));
        awaitSounds(id, 2);
        assertThat(soundStatus(id)).isEqualTo("missing");
        publish(id, true).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("missing_required_sounds"));

        // A failed release changes nothing.
        sound(id, Variant.stock, Stroke.release, Outcome.failed, Instant.parse("2026-11-15T10:01:00Z"));
        sound(id, Variant.stock, Stroke.release, Outcome.ready, Instant.parse("2026-11-15T10:02:00Z"));
        await(() -> "recorded".equals(soundStatus(id)));

        mvc.perform(asEditor(get(SWITCHES + "/" + id)))
            .andExpect(jsonPath("$.soundStatus").value("recorded"))
            .andExpect(jsonPath("$.status").value("draft"))
            .andExpect(jsonPath("$.sounds.length()").value(3))
            .andExpect(jsonPath("$.sounds[0].variant").value("stock"))
            .andExpect(jsonPath("$.sounds[0].stroke").value("press"))
            .andExpect(jsonPath("$.sounds[1].stroke").value("release"))
            .andExpect(jsonPath("$.sounds[2].variant").value("lubed"));

        publish(id, true).andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"2\""))
            .andExpect(jsonPath("$.status").value("published"))
            .andExpect(jsonPath("$.isNew").value(true))
            .andExpect(jsonPath("$.publishedAt").exists());
    }

    @Test
    void theSoundProcessedEventKeepsTheLatestRecordingPerSlot() throws Exception {
        UUID id = createDraft(unique("Milk Yellow"));
        sound(id, Variant.stock, Stroke.press, Outcome.ready, Instant.parse("2026-11-15T10:05:00Z"));
        awaitSounds(id, 1);
        // An older event that arrives late does not replace the newer recording.
        UUID late = sound(id, Variant.stock, Stroke.press, Outcome.ready, Instant.parse("2026-11-15T10:00:00Z"));
        sound(id, Variant.stock, Stroke.release, Outcome.ready, Instant.parse("2026-11-15T10:06:00Z"));
        await(() -> "recorded".equals(soundStatus(id)));
        assertThat(jdbc.sql("SELECT recording_id FROM catalog.switch_recordings WHERE switch_id = ? AND stroke = 'press'")
            .param(id).query(UUID.class).single()).isNotEqualTo(late);

        // An event for a switch that is gone keeps nothing and does not fail.
        UUID gone = UUID.randomUUID();
        sound(gone, Variant.stock, Stroke.press, Outcome.ready, Instant.now());
        sound(id, Variant.foam, Stroke.press, Outcome.ready, Instant.now());
        awaitSounds(id, 3);
        assertThat(jdbc.sql("SELECT count(*) FROM catalog.switch_recordings WHERE switch_id = ?").param(gone)
            .query(Integer.class).single()).isZero();
    }

    // --- The public library -------------------------------------------------------------

    @Test
    void aPublishedSwitchShowsInThePublicLibraryWithTheNewSticker() throws Exception {
        String name = unique("Coral Pop");
        UUID id = readyDraft(name);
        String other = unique("Ink Black");
        UUID plain = readyDraft(other);

        // Drafts never appear, even with their sounds ready.
        mvc.perform(get(LIBRARY).param("q", name)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(0));

        publish(id, true).andExpect(status().isOk());
        publish(plain, false).andExpect(status().isOk());

        MvcResult listed = mvc.perform(get(LIBRARY).param("q", name))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", containsString("max-age=300")))
            .andExpect(header().string("Cache-Control", containsString("public")))
            .andExpect(header().exists("ETag"))
            .andExpect(header().exists("KeyLab-API-Revision"))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].id").value(id.toString()))
            .andExpect(jsonPath("$.data[0].name").value(name))
            .andExpect(jsonPath("$.data[0].type").value("tactile"))
            .andExpect(jsonPath("$.data[0].soundStatus").value("recorded"))
            .andExpect(jsonPath("$.data[0].isNew").value(true))
            .andExpect(jsonPath("$.data[0].publishedAt").exists())
            .andExpect(jsonPath("$.data[0].status").doesNotExist())
            .andExpect(jsonPath("$.page.pageSize").value(24))
            .andReturn();
        mvc.perform(get(LIBRARY).param("q", other))
            .andExpect(jsonPath("$.data[0].isNew").value(false));

        // Within the cache window a client revalidates with the ETag and gets 304.
        String etag = listed.getResponse().getHeader("ETag");
        mvc.perform(get(LIBRARY).param("q", name).header("If-None-Match", etag))
            .andExpect(status().isNotModified())
            .andExpect(header().string("ETag", etag));

        // Signed-in people see the same library.
        mvc.perform(bearer(get(LIBRARY).param("q", name), StubJwks.token(Roles.USER)))
            .andExpect(jsonPath("$.data.length()").value(1));

        // Pulled: gone from the library, kept for builds, and the ETag moves.
        mvc.perform(asEditor(delete(SWITCHES + "/" + id + "/publication"))).andExpect(status().isNoContent());
        mvc.perform(get(LIBRARY).param("q", name).header("If-None-Match", etag))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(0));
        mvc.perform(asEditor(get(SWITCHES + "/" + id))).andExpect(jsonPath("$.status").value("hidden"));

        // Published again: back, with its first publish date.
        publish(id, false).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("published"));
        mvc.perform(get(LIBRARY).param("q", name)).andExpect(jsonPath("$.data[0].isNew").value(false));
    }

    @Test
    void onlyEditorsPublish() throws Exception {
        UUID id = readyDraft(unique("Hush Red"));
        mvc.perform(post(SWITCHES + "/" + id + "/publication").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(bearer(post(SWITCHES + "/" + id + "/publication"), viewer)
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isForbidden());
        mvc.perform(bearer(delete(SWITCHES + "/" + id + "/publication"), viewer)).andExpect(status().isForbidden());
        publish(UUID.randomUUID(), false).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("switch_not_found"));
        mvc.perform(asEditor(post(SWITCHES + "/not-an-id/publication")).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void aPublishedSwitchCannotBeDeleted() throws Exception {
        UUID id = readyDraft(unique("Peak Tactile"));
        publish(id, false).andExpect(status().isOk());
        mvc.perform(asEditor(delete(SWITCHES + "/" + id)).header("If-Match", "\"2\""))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("switch_not_draft"));
    }

    // --- Helpers ------------------------------------------------------------------------

    static String unique(String name) {
        return name + " " + UUID.randomUUID().toString().substring(0, 8);
    }

    MockHttpServletRequestBuilder asEditor(MockHttpServletRequestBuilder request) {
        return bearer(request, editor);
    }

    org.springframework.test.web.servlet.ResultActions publish(UUID id, boolean markNew) throws Exception {
        return mvc.perform(asEditor(post(SWITCHES + "/" + id + "/publication"))
            .contentType(MediaType.APPLICATION_JSON).content("{ \"markNew\": " + markNew + " }"));
    }

    UUID createDraft(String name) throws Exception {
        String body = """
                { "name": "%s", "brand": "Clack Works", "type": "tactile", "profile": "poppy",
                  "stemColor": "#F16B53", "forceG": 62, "actuationMm": 2.0, "travelMm": 3.8 }
                """.formatted(name);
        MvcResult created = mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn();
        JsonNode node = json.readTree(created.getResponse().getContentAsString());
        return UUID.fromString(node.get("id").asString());
    }

    UUID readyDraft(String name) throws Exception {
        UUID id = createDraft(name);
        Instant at = Instant.now();
        sound(id, Variant.stock, Stroke.press, Outcome.ready, at);
        sound(id, Variant.stock, Stroke.release, Outcome.ready, at);
        await(() -> "recorded".equals(soundStatus(id)));
        return id;
    }

    /** What the sound module will publish when a recording finishes (US-38). */
    UUID sound(UUID switchId, Variant variant, Stroke stroke, Outcome outcome, Instant at) {
        UUID recordingId = UUID.randomUUID();
        boolean ready = outcome == Outcome.ready;
        SoundProcessed event = new SoundProcessed(recordingId, switchId, variant, stroke, outcome,
                ready ? "https://cdn.keylab.test/assets/sounds/" + recordingId + ".opus" : null, ready ? 180 : null,
                ready ? new BigDecimal("-14.5") : null, ready ? List.of(0.1, 0.8, 0.3) : List.of(), at);
        tx.executeWithoutResult((status) -> events.publishEvent(event));
        return recordingId;
    }

    String soundStatus(UUID id) {
        return jdbc.sql("SELECT sound_status FROM catalog.switches WHERE id = ?").param(id).query(String.class)
            .single();
    }

    void awaitSounds(UUID id, int count) {
        await(() -> jdbc.sql("SELECT count(*) FROM catalog.switch_recordings WHERE switch_id = ?").param(id)
            .query(Integer.class).single() == count);
    }

    /** Listeners run after commit, possibly on another thread. */
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
