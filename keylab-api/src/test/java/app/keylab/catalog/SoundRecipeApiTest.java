package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-05: the sound recipe for any parts mix (BLD-10), open to guests and
 * cached like the catalog. Uses the KL2-1 seed for mods, keycap sets and case
 * parts, and a switch of its own with recordings.
 */
class SoundRecipeApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String RECIPE = "/v1/sound-recipe";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    @Test
    void returnsSamplesFiltersMeterAndWordForAGuestCachedFor300s() throws Exception {
        String slug = publishedSwitch("deep");

        JsonNode stock = read(mvc.perform(get(RECIPE).param("switch", slug))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=300, public"))
            .andExpect(header().exists(HttpHeaders.ETAG))
            .andExpect(jsonPath("$.samples.length()").value(2))
            .andExpect(jsonPath("$.samples[0].variant").value("stock"))
            .andExpect(jsonPath("$.samples[0].stroke").value("press"))
            .andExpect(jsonPath("$.samples[1].stroke").value("release"))
            .andExpect(jsonPath("$.filters.lowShelfDb").value(0.0))
            .andExpect(jsonPath("$.filters.highShelfDb").value(0.0))
            .andExpect(jsonPath("$.filters.reverbMix").value(0.12))
            .andExpect(jsonPath("$.filters.gainDb").value(0.0))
            .andExpect(jsonPath("$.meter.position").value(0.38))
            .andExpect(jsonPath("$.meter.word").value("Deep & rounded"))
            .andReturn());
        assertThat(stock.at("/samples/0/url").asString()).endsWith("stock-press.wav");

        // Every kind of part at once: the meter moves and the filters change.
        JsonNode full = read(mvc.perform(get(RECIPE).param("switch", slug).param("variant", "lubed")
                .param("mod", "lube:light", "case-foam", "stabs").param("keycap_set", "cream-paper")
                .param("case_material", "alu").param("plate", "pc").param("mount", "gasket"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(full.at("/meter/position").asDouble()).isLessThan(0.38);
        assertThat(full.at("/meter/word").asString()).isEqualTo("Deep & muted");
        assertThat(full.at("/filters/gainDb").asDouble()).isNegative();
        // The lubed press exists; the release falls back to stock.
        assertThat(full.at("/samples/0/variant").asString()).isEqualTo("lubed");
        assertThat(full.at("/samples/1/variant").asString()).isEqualTo("stock");
    }

    @Test
    void theOrderOfTheModsDoesNotChangeTheAnswerAndAMatchingTagGets304() throws Exception {
        String slug = publishedSwitch("poppy");
        MvcResult one = mvc.perform(get(RECIPE).param("switch", slug).param("mod", "case-foam", "lube:heavy"))
            .andExpect(status().isOk()).andReturn();
        MvcResult two = mvc.perform(get(RECIPE).param("mod", "lube:heavy").param("switch", slug)
                .param("mod", "case-foam"))
            .andExpect(status().isOk()).andReturn();
        assertThat(two.getResponse().getContentAsString()).isEqualTo(one.getResponse().getContentAsString());
        String etag = one.getResponse().getHeader(HttpHeaders.ETAG);
        assertThat(two.getResponse().getHeader(HttpHeaders.ETAG)).isEqualTo(etag);

        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "case-foam", "lube:heavy")
                .header(HttpHeaders.IF_NONE_MATCH, etag))
            .andExpect(status().isNotModified())
            .andExpect(header().string(HttpHeaders.ETAG, etag));
    }

    @Test
    void togglingEachModChangesTheSound() throws Exception {
        String slug = publishedSwitch("deep");
        String stock = body(mvc.perform(get(RECIPE).param("switch", slug)).andReturn());
        for (String mod : new String[] { "lube:light", "lube:heavy", "case-foam", "pe-foam", "stabs", "o-rings" }) {
            String on = body(mvc.perform(get(RECIPE).param("switch", slug).param("mod", mod))
                .andExpect(status().isOk()).andReturn());
            assertThat(on).as(mod).isNotEqualTo(stock);
        }
        // An off level is the same as leaving the mod out.
        String off = body(mvc.perform(get(RECIPE).param("switch", slug).param("mod", "lube:none")).andReturn());
        assertThat(off).isEqualTo(stock);
    }

    @Test
    void pulledAndRetiredPartsStillPlayDraftsDoNot() throws Exception {
        String slug = publishedSwitch("deep");
        // Holee mod is switched off, Ink Blank hidden: an old shared build still plays.
        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "holee-mod").param("keycap_set", "ink-blank"))
            .andExpect(status().isOk());
        // Pulled from the library (US-39 sets it hidden).
        jdbc.sql("UPDATE catalog.switches SET status = 'hidden' WHERE slug = ?").param(slug).update();
        mvc.perform(get(RECIPE).param("switch", slug)).andExpect(status().isOk());

        // Lime Pop is a draft keycap set; a draft switch never resolves.
        String draft = createSwitch("deep", false);
        mvc.perform(get(RECIPE).param("switch", draft).param("keycap_set", "lime-pop"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/problem+json"))
            .andExpect(jsonPath("$.code").value("part_not_found"))
            .andExpect(jsonPath("$.errors.length()").value(2))
            .andExpect(jsonPath("$.errors[0].pointer").value("/switch"))
            .andExpect(jsonPath("$.errors[1].pointer").value("/keycap_set"));
    }

    @Test
    void unknownPartsAndBadLevelsAre422WithOnePointerEach() throws Exception {
        String slug = publishedSwitch("deep");
        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "case-foam", "nope").param("plate", "glass")
                .param("mount", "nope").param("case_material", "nope"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("part_not_found"))
            .andExpect(jsonPath("$.errors[0].pointer").value("/mod/1"))
            .andExpect(jsonPath("$.errors[1].pointer").value("/case_material"))
            .andExpect(jsonPath("$.errors[2].pointer").value("/plate"))
            .andExpect(jsonPath("$.errors[3].pointer").value("/mount"));

        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "lube"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("level_required"))
            .andExpect(jsonPath("$.errors[0].pointer").value("/mod/0"));
        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "stabs", "lube:extra"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("level_not_offered"))
            .andExpect(jsonPath("$.errors[0].pointer").value("/mod/1"));
        // A toggle mod has no levels to name.
        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "case-foam:light"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("level_not_offered"));
        // Different reasons: the generic code, each entry keeps its own.
        mvc.perform(get(RECIPE).param("switch", slug).param("mod", "lube", "nope"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("validation_failed"))
            .andExpect(jsonPath("$.errors[0].code").value("level_required"))
            .andExpect(jsonPath("$.errors[1].code").value("part_not_found"));
    }

    @Test
    void malformedRequestsAre400() throws Exception {
        String slug = publishedSwitch("deep");
        expect400(get(RECIPE));
        expect400(get(RECIPE).param("switch", slug, slug));
        expect400(get(RECIPE).param("switch", slug).param("plate", "alu", "brass"));
        expect400(get(RECIPE).param("switch", slug).param("variant", "dusty"));
        expect400(get(RECIPE).param("switch", slug).param("mod", "Lube:Light"));
        expect400(get(RECIPE).param("switch", slug).param("mod", "lube:light:x"));
        expect400(get(RECIPE).param("switch", slug).param("mod", "lube:light", "lube:heavy"));
        expect400(get(RECIPE).param("switch", ""));
    }

    // --- Helpers ------------------------------------------------------------------------

    void expect400(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        mvc.perform(request)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_parameter"));
    }

    /** A published switch with a stock press and release and a lubed press. */
    String publishedSwitch(String profile) throws Exception {
        String slug = createSwitch(profile, true);
        UUID id = idOf(slug);
        recording(id, "stock", "press");
        recording(id, "stock", "release");
        recording(id, "lubed", "press");
        return slug;
    }

    String createSwitch(String profile, boolean publish) throws Exception {
        String name = "Recipe " + UUID.randomUUID().toString().substring(0, 8);
        String body = """
                { "name": "%s", "brand": "Recipe Works", "type": "linear", "profile": "%s" }
                """.formatted(name, profile);
        MvcResult created = mvc
            .perform(bearer(post(SWITCHES), editor).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn();
        JsonNode sw = json.readTree(created.getResponse().getContentAsString());
        if (publish) {
            jdbc.sql("UPDATE catalog.switches SET sound_status = 'recorded' WHERE id = ?")
                .param(UUID.fromString(sw.get("id").asString())).update();
            mvc.perform(bearer(post(SWITCHES + "/" + sw.get("id").asString() + "/publication"), editor)
                    .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        }
        return sw.get("slug").asString();
    }

    UUID idOf(String slug) {
        return jdbc.sql("SELECT id FROM catalog.switches WHERE slug = ?").param(slug).query(UUID.class).single();
    }

    void recording(UUID switchId, String variant, String stroke) {
        jdbc.sql("""
                INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms,
                  loudness_lufs, peaks, processed_at)
                VALUES (?, ?, ?, ?, ?, 180, -14.5, '[0.1,0.8,0.3]', now())
                """)
            .params(switchId, variant, stroke, UUID.randomUUID(),
                    "/bff/keylab/v1/assets/sounds/" + variant + "-" + stroke + ".wav")
            .update();
    }

    JsonNode read(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }

    static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }
}
