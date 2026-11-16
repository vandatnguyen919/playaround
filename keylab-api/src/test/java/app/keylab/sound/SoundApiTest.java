package app.keylab.sound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;

import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-38 through the real filter chain, Postgres and the event registry:
 * presigned upload, attach (202), processing to ready or failed with peaks,
 * length and loudness, catalog hearing of it, the ADM-05 lists, deleting a
 * take, and a switch photo through the same uploads.
 */
class SoundApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String UPLOADS = "/v1/admin/uploads";
    static final String SOUNDS = "/v1/admin/sounds";
    /** What the browser sees in front of the API path; MockMvc calls keylab-api directly. */
    static final String BFF = "/bff/keylab";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);
    final String viewer = StubJwks.token(Roles.USER, Roles.VIEWER);

    @Autowired
    JsonMapper json;

    @Autowired
    JdbcClient jdbc;

    // --- Upload, attach, process ---------------------------------------------------------

    @Test
    void aGoodTakeIsProcessedToReadyAndCatalogHearsOfIt() throws Exception {
        UUID sw = createDraft(unique("Coral Pop"));

        JsonNode ticket = ticket("sound", "audio/wav", "coral-pop_stock_press.wav");
        assertThat(ticket.get("url").asString()).startsWith("/bff/keylab/v1/uploads/" + ticket.get("uploadId").asString()
                + "?expires=");
        assertThat(ticket.get("headers").get("Content-Type").asString()).isEqualTo("audio/wav");
        assertThat(Instant.parse(ticket.get("expiresAt").asString())).isAfter(Instant.now().plusSeconds(600));
        mvc.perform(put(path(ticket)).content(Wavs.good())).andExpect(status().isNoContent());

        MvcResult attached = attach(sw, ticket, "stock", "press")
            .andExpect(status().isAccepted())
            .andExpect(header().string("Location", startsWith(SOUNDS + "/")))
            .andExpect(jsonPath("$.status").value("processing"))
            .andExpect(jsonPath("$.switchId").value(sw.toString()))
            .andExpect(jsonPath("$.variant").value("stock"))
            .andExpect(jsonPath("$.stroke").value("press"))
            .andExpect(jsonPath("$.fileName").value("coral-pop_stock_press.wav"))
            .andExpect(jsonPath("$.url").doesNotExist())
            .andReturn();
        String location = attached.getResponse().getHeader("Location");

        JsonNode ready = awaitDone(location);
        assertThat(ready.get("status").asString()).isEqualTo("ready");
        assertThat(ready.get("durationMs").asInt()).isEqualTo(200);
        assertThat(ready.get("loudnessLufs").asDouble()).isBetween(-40.0, -10.0);
        assertThat(ready.get("peaks")).hasSize(64);
        assertThat(ready.get("url").asString()).matches("/bff/keylab/v1/assets/sounds/[0-9a-f]{64}\\.wav");
        assertThat(ready.get("processedAt")).isNotNull();

        // The file is served content-addressed and public, like a CDN, with the bytes that were uploaded.
        String asset = ready.get("url").asString().substring(BFF.length());
        MvcResult file = mvc.perform(get(asset))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "audio/wav"))
            .andExpect(header().string("Cache-Control", containsString("immutable")))
            .andReturn();
        assertThat(file.getResponse().getContentAsByteArray()).isEqualTo(Wavs.good());

        // Catalog keeps its copy, so the publish checklist ticks the stock press.
        await(() -> recordingsInCatalog(sw) == 1);
        mvc.perform(asEditor(get(SWITCHES + "/" + sw)))
            .andExpect(jsonPath("$.sounds[0].id").value(ready.get("id").asString()))
            .andExpect(jsonPath("$.sounds[0].url").value(ready.get("url").asString()))
            .andExpect(jsonPath("$.soundStatus").value("missing"));

        // With the release too, the switch is recorded and can be published (US-39).
        String release = attach(sw, uploaded(Wavs.good(), "release.wav"), "stock", "release")
            .andExpect(status().isAccepted()).andReturn().getResponse().getHeader("Location");
        assertThat(awaitDone(release).get("status").asString()).isEqualTo("ready");
        await(() -> "recorded".equals(soundStatus(sw)));
        mvc.perform(asEditor(post(SWITCHES + "/" + sw + "/publication")).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk());
    }

    @Test
    void aTakeInTheWrongFormatFailsWithAReasonAndChangesNothingInCatalog() throws Exception {
        UUID sw = createDraft(unique("Milk Yellow"));
        byte[] cd = Wavs.encode(Wavs.click(44_100, 0.2, 0.5), 44_100, 16, 2);
        String location = attach(sw, uploaded(cd, "cd.wav"), "lubed", "press")
            .andExpect(status().isAccepted()).andReturn().getResponse().getHeader("Location");
        JsonNode failed = awaitDone(location);
        assertThat(failed.get("status").asString()).isEqualTo("failed");
        assertThat(failed.get("error").asString())
            .isEqualTo("It is 44.1 kHz, 16-bit stereo. Upload a 48 kHz, 24-bit mono WAV.");
        assertThat(failed.has("url")).isFalse();
        assertThat(failed.has("peaks")).isFalse();

        byte[] loud = Wavs.encode(Wavs.click(48_000, 0.2, 1.5), 48_000, 24, 1);
        String clipped = attach(sw, uploaded(loud, "loud.wav"), "lubed", "press")
            .andReturn().getResponse().getHeader("Location");
        assertThat(awaitDone(clipped).get("error").asString()).startsWith("It clips at 0 dBFS.");

        Thread.sleep(200);
        assertThat(recordingsInCatalog(sw)).isZero();
    }

    // --- ADM-05 lists and delete ---------------------------------------------------------

    @Test
    void listsRecordingsByStatusAndSwitchNewestFirst() throws Exception {
        UUID sw = createDraft(unique("Ink Black"));
        String first = attach(sw, uploaded(Wavs.good(), "a.wav"), "stock", "press").andReturn().getResponse()
            .getHeader("Location");
        String second = attach(sw, uploaded(Wavs.encode(Wavs.click(48_000, 0.2, 0.5), 48_000, 16, 1), "b.wav"),
                "stock", "release").andReturn().getResponse().getHeader("Location");
        String third = attach(sw, uploaded(Wavs.good(), "c.wav"), "foam", "press").andReturn().getResponse()
            .getHeader("Location");
        awaitDone(first);
        awaitDone(second);
        awaitDone(third);

        mvc.perform(asEditor(get(SOUNDS).param("switch_id", sw.toString()).param("page_size", "2")))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.data[0].fileName").value("c.wav"))
            .andExpect(jsonPath("$.data[1].fileName").value("b.wav"))
            .andExpect(jsonPath("$.page.nextPageToken").isNotEmpty());
        JsonNode page1 = body(mvc.perform(asEditor(get(SOUNDS).param("switch_id", sw.toString())
                .param("page_size", "2"))).andReturn());
        mvc.perform(asEditor(get(SOUNDS).param("switch_id", sw.toString()).param("page_size", "2")
                .param("page_token", page1.get("page").get("nextPageToken").asString())))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].fileName").value("a.wav"))
            .andExpect(jsonPath("$.page.nextPageToken").isEmpty());

        JsonNode failed = body(mvc.perform(asEditor(get(SOUNDS).param("status", "failed").param("page_size", "100")))
            .andReturn());
        assertThat(failed.get("data").valueStream().map((s) -> s.get("fileName").asString())).contains("b.wav")
            .doesNotContain("a.wav", "c.wav");

        mvc.perform(asEditor(get(SOUNDS).param("status", "loud"))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_parameter"));
        mvc.perform(asEditor(get(SOUNDS).param("switch_id", "nope"))).andExpect(status().isBadRequest());
        mvc.perform(asEditor(get(SOUNDS + "/" + UUID.randomUUID()))).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("sound_not_found"));
    }

    @Test
    void deletingTheTakeThatPlaysFallsBackToTheOlderOne() throws Exception {
        UUID sw = createDraft(unique("Sapphire Click"));
        JsonNode older = awaitDone(attach(sw, uploaded(Wavs.good(), "old.wav"), "stock", "press").andReturn()
            .getResponse().getHeader("Location"));
        await(() -> recordingsInCatalog(sw) == 1);
        byte[] quieter = Wavs.encode(Wavs.click(48_000, 0.25, 0.3), 48_000, 24, 1);
        JsonNode newer = awaitDone(attach(sw, uploaded(quieter, "new.wav"), "stock", "press").andReturn()
            .getResponse().getHeader("Location"));
        await(() -> newer.get("id").asString().equals(catalogPress(sw)));

        mvc.perform(asEditor(delete(SOUNDS + "/" + newer.get("id").asString()))).andExpect(status().isNoContent());
        mvc.perform(asEditor(get(SOUNDS + "/" + newer.get("id").asString()))).andExpect(status().isNotFound());
        await(() -> older.get("id").asString().equals(catalogPress(sw)));

        // The last take goes too: the slot is empty in catalog.
        mvc.perform(asEditor(delete(SOUNDS + "/" + older.get("id").asString()))).andExpect(status().isNoContent());
        await(() -> recordingsInCatalog(sw) == 0);
    }

    @Test
    void thePublishedSwitchKeepsItsOnlyStockTake() throws Exception {
        UUID sw = createDraft(unique("Jade Hush"));
        JsonNode press = awaitDone(attach(sw, uploaded(Wavs.good(), "p.wav"), "stock", "press").andReturn()
            .getResponse().getHeader("Location"));
        awaitDone(attach(sw, uploaded(Wavs.good(), "r.wav"), "stock", "release").andReturn().getResponse()
            .getHeader("Location"));
        await(() -> "recorded".equals(soundStatus(sw)));
        mvc.perform(asEditor(post(SWITCHES + "/" + sw + "/publication")).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk());

        mvc.perform(asEditor(delete(SOUNDS + "/" + press.get("id").asString())))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("sound_in_use"));
    }

    // --- Refusals ------------------------------------------------------------------------

    @Test
    void ticketsCheckPurposeTypeAndSize() throws Exception {
        mvc.perform(asEditor(post(UPLOADS)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"purpose\": \"sound\", \"contentType\": \"audio/flac\", \"bytes\": 20000000 }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/contentType"))
            .andExpect(jsonPath("$.errors[0].code").value("unsupported_content_type"))
            .andExpect(jsonPath("$.errors[1].pointer").value("/bytes"))
            .andExpect(jsonPath("$.errors[1].code").value("file_too_large"));
        mvc.perform(asEditor(post(UPLOADS)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"purpose\": \"avatar\", \"contentType\": \"image/png\" }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].code").value("unsupported_purpose"));
        mvc.perform(bearer(post(UPLOADS), viewer).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"purpose\": \"sound\", \"contentType\": \"audio/wav\" }"))
            .andExpect(status().isForbidden());
        mvc.perform(post(UPLOADS).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"purpose\": \"sound\", \"contentType\": \"audio/wav\" }"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void theUploadUrlIsThePermissionAndWorksOnce() throws Exception {
        JsonNode ticket = ticket("sound", "audio/wav", null);
        String url = path(ticket);
        mvc.perform(put(url.replaceAll("signature=[0-9a-f]+", "signature=00")).content(Wavs.good()))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("invalid_upload_signature"));
        mvc.perform(put(url.replaceAll("expires=\\d+", "expires=1")).content(Wavs.good()))
            .andExpect(status().isForbidden());
        mvc.perform(put(url).content(new byte[0])).andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].code").value("empty_file"));
        mvc.perform(put(url).content(new byte[10 * 1024 * 1024 + 1])).andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].code").value("file_too_large"));

        UUID sw = createDraft(unique("Proto Orange"));
        // Not there yet: nothing to attach.
        attach(sw, ticket, "stock", "press").andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/uploadId"))
            .andExpect(jsonPath("$.errors[0].code").value("upload_not_received"));
        mvc.perform(put(url).content(Wavs.good())).andExpect(status().isNoContent());
        attach(sw, ticket, "stock", "press").andExpect(status().isAccepted());
        // Used once: a second attach and a second PUT are refused.
        attach(sw, ticket, "stock", "release").andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].code").value("upload_already_used"));
        mvc.perform(put(url).content(Wavs.good())).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("upload_already_used"));
    }

    @Test
    void attachChecksTheSwitchAndTheSlot() throws Exception {
        JsonNode ticket = uploaded(Wavs.good(), null);
        attach(UUID.randomUUID(), ticket, "stock", "press").andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("switch_not_found"));
        UUID sw = createDraft(unique("Hush Red"));
        attach(sw, ticket, "deep", "tap").andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/variant"))
            .andExpect(jsonPath("$.errors[1].pointer").value("/stroke"));
        mvc.perform(bearer(post(SWITCHES + "/" + sw + "/sounds"), viewer).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isForbidden());
        mvc.perform(get("/v1/assets/sounds/" + "0".repeat(64) + ".wav")).andExpect(status().isNotFound());
        mvc.perform(get("/v1/assets/sounds/..%2Fsecret")).andExpect(status().is4xxClientError());
        mvc.perform(get("/v1/assets/sounds/" + "0".repeat(64) + ".png")).andExpect(status().isNotFound());
    }

    // --- Switch photo (moved from US-37) -------------------------------------------------

    @Test
    void aSquarePhotoAttachesToTheSwitch() throws Exception {
        UUID sw = createDraft(unique("Photo Pop"));
        JsonNode small = uploaded(Wavs.png(400, 400), "image/png", "switch_photo");
        patchSwitch(sw, "{ \"photoUploadId\": \"" + small.get("uploadId").asString() + "\" }")
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/photoUploadId"))
            .andExpect(jsonPath("$.errors[0].code").value("photo_too_small"));
        JsonNode wide = uploaded(Wavs.png(1200, 800), "image/png", "switch_photo");
        patchSwitch(sw, "{ \"photoUploadId\": \"" + wide.get("uploadId").asString() + "\" }")
            .andExpect(jsonPath("$.errors[0].code").value("photo_not_square"));
        JsonNode sound = uploaded(Wavs.good(), null);
        patchSwitch(sw, "{ \"photoUploadId\": \"" + sound.get("uploadId").asString() + "\" }")
            .andExpect(jsonPath("$.errors[0].code").value("upload_wrong_purpose"));

        JsonNode good = uploaded(Wavs.png(800, 800), "image/png", "switch_photo");
        String photoUrl = body(patchSwitch(sw, "{ \"photoUploadId\": \"" + good.get("uploadId").asString() + "\" }")
            .andExpect(status().isOk())
            .andReturn()).get("photoUrl").asString();
        assertThat(photoUrl).matches("/bff/keylab/v1/assets/photos/[0-9a-f]{64}\\.png");
        mvc.perform(get(photoUrl.substring(BFF.length()))).andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "image/png"));
        mvc.perform(asEditor(get(SWITCHES + "/" + sw))).andExpect(jsonPath("$.photoUrl").value(photoUrl));

        // Null clears it; leaving the field out keeps it.
        patchSwitch(sw, "{ \"brand\": \"Clack Works\" }").andExpect(jsonPath("$.photoUrl").value(photoUrl));
        patchSwitch(sw, "{ \"photoUploadId\": null }").andExpect(jsonPath("$.photoUrl").doesNotExist());
    }

    @Test
    void theAdminListFindsDraftsByName() throws Exception {
        String tag = UUID.randomUUID().toString().substring(0, 8);
        createDraft("Zeta " + tag);
        createDraft("Alpha " + tag);
        createDraft("Mid " + tag);
        JsonNode first = body(mvc.perform(asEditor(get(SWITCHES).param("q", tag).param("page_size", "2")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].name").value("Alpha " + tag))
            .andExpect(jsonPath("$.data[0].status").value("draft"))
            .andExpect(jsonPath("$.data[0].sounds").isArray())
            .andExpect(jsonPath("$.data[1].name").value("Mid " + tag))
            .andReturn());
        mvc.perform(asEditor(get(SWITCHES).param("q", tag).param("page_token",
                first.get("page").get("nextPageToken").asString())))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].name").value("Zeta " + tag));
    }

    // --- Helpers -------------------------------------------------------------------------

    static String unique(String name) {
        return name + " " + UUID.randomUUID().toString().substring(0, 8);
    }

    MockHttpServletRequestBuilder asEditor(MockHttpServletRequestBuilder request) {
        return bearer(request, editor);
    }

    UUID createDraft(String name) throws Exception {
        MvcResult created = mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"name\": \"" + name + "\", \"type\": \"tactile\" }"))
            .andExpect(status().isCreated())
            .andReturn();
        return UUID.fromString(body(created).get("id").asString());
    }

    ResultActions patchSwitch(UUID id, String patchBody) throws Exception {
        String etag = mvc.perform(asEditor(get(SWITCHES + "/" + id))).andReturn().getResponse().getHeader("ETag");
        return mvc.perform(asEditor(patch(SWITCHES + "/" + id)).contentType("application/merge-patch+json")
            .header("If-Match", etag).content(patchBody));
    }

    JsonNode ticket(String purpose, String contentType, String fileName) throws Exception {
        String name = fileName == null ? "" : ", \"fileName\": \"" + fileName + "\"";
        MvcResult result = mvc.perform(asEditor(post(UPLOADS)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"purpose\": \"" + purpose + "\", \"contentType\": \"" + contentType + "\"" + name + " }"))
            .andExpect(status().isCreated())
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andReturn();
        return body(result);
    }

    JsonNode uploaded(byte[] wav, String fileName) throws Exception {
        JsonNode ticket = ticket("sound", "audio/wav", fileName);
        mvc.perform(put(path(ticket)).content(wav)).andExpect(status().isNoContent());
        return ticket;
    }

    JsonNode uploaded(byte[] file, String contentType, String purpose) throws Exception {
        JsonNode ticket = ticket(purpose, contentType, null);
        mvc.perform(put(path(ticket)).content(file)).andExpect(status().isNoContent());
        return ticket;
    }

    ResultActions attach(UUID sw, JsonNode ticket, String variant, String stroke) throws Exception {
        return mvc.perform(asEditor(post(SWITCHES + "/" + sw + "/sounds")).contentType(MediaType.APPLICATION_JSON)
            .content("{ \"uploadId\": \"" + ticket.get("uploadId").asString() + "\", \"variant\": \"" + variant
                    + "\", \"stroke\": \"" + stroke + "\" }"));
    }

    /** The ticket URL as keylab-api sees it, behind the gateway's /bff/keylab prefix. */
    static String path(JsonNode ticket) {
        return ticket.get("url").asString().substring(BFF.length());
    }

    JsonNode awaitDone(String location) throws Exception {
        Instant until = Instant.now().plus(Duration.ofSeconds(10));
        while (true) {
            JsonNode sound = body(mvc.perform(asEditor(get(location))).andExpect(status().isOk()).andReturn());
            if (!"processing".equals(sound.get("status").asString())) {
                return sound;
            }
            if (Instant.now().isAfter(until)) {
                throw new AssertionError("Still processing: " + location);
            }
            Thread.sleep(50);
        }
    }

    void await(Supplier<Boolean> condition) throws InterruptedException {
        Instant until = Instant.now().plus(Duration.ofSeconds(10));
        while (!condition.get()) {
            if (Instant.now().isAfter(until)) {
                throw new AssertionError("Condition not met in time");
            }
            Thread.sleep(50);
        }
    }

    int recordingsInCatalog(UUID sw) {
        return jdbc.sql("SELECT count(*) FROM catalog.switch_recordings WHERE switch_id = ?").param(sw)
            .query(Integer.class).single();
    }

    String catalogPress(UUID sw) {
        return jdbc.sql("""
                SELECT recording_id::text FROM catalog.switch_recordings
                WHERE switch_id = ? AND variant = 'stock' AND stroke = 'press'
                """).param(sw).query(String.class).optional().orElse(null);
    }

    String soundStatus(UUID sw) {
        return jdbc.sql("SELECT sound_status FROM catalog.switches WHERE id = ?").param(sw).query(String.class)
            .single();
    }

    JsonNode body(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }
}
