package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import app.keylab.testing.IntegrationTest;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * KL2-1: the seeded parts catalog and its public read side (CAT-05 to
 * CAT-08). Guests read it without a token; only published keycap sets, live
 * mods and active case parts appear, in screen order, cached like the switch
 * library. Rows a test adds sit after the seed (position 900+) and are removed
 * again, so the seed assertions hold whatever else runs.
 */
class PartsCatalogApiTest extends IntegrationTest {

    static final List<String> PUBLISHED_SETS = List.of("cream-paper", "navy-sun", "sky-lab", "coral-reef");
    static final List<String> LIVE_MODS = List.of("lube", "case-foam", "pe-foam", "stabs", "o-rings", "spring-swap");

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    @Test
    void seedHoldsTheDesignedPartsMarkedAsSeed() {
        assertThat(seedCount("keycap_sets")).isEqualTo(6);
        assertThat(seedCount("mods")).isEqualTo(7);
        assertThat(seedCount("case_materials")).isEqualTo(4);
        assertThat(seedCount("plates")).isEqualTo(5);
        assertThat(seedCount("mounts")).isEqualTo(3);
        // Every seeded part carries its sound effect values.
        for (String table : List.of("mods", "case_materials", "plates", "mounts")) {
            assertThat(jdbc.sql("SELECT count(*) FROM catalog." + table + " WHERE is_seed AND sound_fx = '{}'::jsonb")
                .query(Integer.class).single()).isZero();
        }
    }

    @Test
    void listsPublishedKeycapSetsInScreenOrderForGuests() throws Exception {
        JsonNode body = read(mvc.perform(get("/v1/keycap-sets"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=300, public"))
            .andExpect(header().exists(HttpHeaders.ETAG))
            .andReturn());

        // The draft (Lime Pop) and the hidden set (Ink Blank) never show.
        assertThat(seedSlugs(body.get("data"), PUBLISHED_SETS)).containsExactlyElementsOf(PUBLISHED_SETS);
        assertThat(slugs(body.get("data"))).doesNotContain("lime-pop", "ink-blank");
        assertThat(body.at("/page/pageSize").asInt()).isEqualTo(24);

        JsonNode cream = body.get("data").get(0);
        assertThat(json.writeValueAsString(cream)).isEqualTo("""
                {"id":"0193a8c0-0000-7000-8000-000000000101","slug":"cream-paper","name":"Cream Paper",\
                "material":"pbt","profile":"cherry","colors":{"base":"#FFFDF5","alpha":"#FFFDF5",\
                "mod":"#2C2A5A","accent":"#F16B53"},"soundShift":-0.25,"keys":104}""");
        assertThat(body.at("/data/2/soundShift").asDouble()).isEqualTo(0.5);
        assertThat(body.at("/data/3/soundShift").asInt()).isZero();
    }

    @Test
    void pagesKeycapSetsByCursorAndRefusesAnotherListsToken() throws Exception {
        JsonNode first = read(mvc.perform(get("/v1/keycap-sets").param("page_size", "2"))
            .andExpect(status().isOk()).andReturn());
        assertThat(slugs(first.get("data"))).containsExactly("cream-paper", "navy-sun");
        String token = first.at("/page/nextPageToken").asString();
        assertThat(token).isNotBlank();

        JsonNode second = read(mvc.perform(get("/v1/keycap-sets").param("page_size", "2").param("page_token", token))
            .andExpect(status().isOk()).andReturn());
        assertThat(slugs(second.get("data"))).startsWith("sky-lab", "coral-reef");

        mvc.perform(get("/v1/mods").param("page_token", token))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_token"));
        mvc.perform(get("/v1/keycap-sets").param("page_token", "not-a-token"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_token"));
        mvc.perform(get("/v1/keycap-sets").param("page_size", "0"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_size"));
    }

    @Test
    void oneKeycapSetBySlugAndNotFoundUnlessPublished() throws Exception {
        mvc.perform(get("/v1/keycap-sets/navy-sun"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=300, public"))
            .andExpect(jsonPath("$.name").value("Navy Sun"))
            .andExpect(jsonPath("$.colors.base").value("#2C2A5A"))
            .andExpect(jsonPath("$.colors.accent").value("#FFD24D"))
            .andExpect(jsonPath("$.soundShift").value(-0.25));

        for (String slug : List.of("lime-pop", "ink-blank", "no-such-set")) {
            mvc.perform(get("/v1/keycap-sets/" + slug))
                .andExpect(status().isNotFound())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, containsString("application/problem+json")))
                .andExpect(jsonPath("$.code").value("keycap_set_not_found"));
        }
    }

    @Test
    void listsLiveModsWithLevelsAndEffects() throws Exception {
        JsonNode body = read(mvc.perform(get("/v1/mods"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=300, public"))
            .andReturn());
        JsonNode data = body.get("data");
        assertThat(seedSlugs(data, LIVE_MODS)).containsExactlyElementsOf(LIVE_MODS);
        assertThat(slugs(data)).doesNotContain("holee-mod");

        JsonNode lube = data.get(0);
        assertThat(json.writeValueAsString(lube)).isEqualTo("""
                {"id":"0193a8c0-0000-7000-8000-000000000201","slug":"lube","name":"Lube",\
                "description":"Lubing stems and springs smooths the stroke and rounds off scratchy, high-pitched noise.",\
                "impact":"smoother · deeper","levels":["none","light","heavy"],"effects":{"pitch":-1,"thock":1,"volume":-1,"rattle":-1},\
                "live":true}""");
        // A toggle mod has no levels.
        assertThat(data.get(1).has("levels")).isFalse();
        assertThat(data.at("/3/effects/rattle").asInt()).isEqualTo(-3);
        assertThat(data.at("/5/levels/2").asString()).isEqualTo("heavier");
    }

    @Test
    void switchingAModOffHidesItFromTheBuilder() throws Exception {
        UUID id = UUID.randomUUID();
        String slug = "kl21-test-" + id.toString().substring(0, 8);
        jdbc.sql("""
                INSERT INTO catalog.mods (id, slug, name, description, kind, sound_fx, live, position)
                VALUES (?, ?, 'Test mod', 'Added by a test', 'toggle', '{"pitch":1,"thock":0,"volume":0,"rattle":0}', true, 900)
                """).params(id, slug).update();
        try {
            assertThat(slugs(allMods())).contains(slug);
            jdbc.sql("UPDATE catalog.mods SET live = false WHERE id = ?").param(id).update();
            assertThat(slugs(allMods())).doesNotContain(slug);
        }
        finally {
            jdbc.sql("DELETE FROM catalog.mods WHERE id = ?").param(id).update();
        }
    }

    @Test
    void caseOptionsListActiveMaterialsPlatesAndMounts() throws Exception {
        String plate = "kl21-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.sql("""
                INSERT INTO catalog.plates (id, name, note, flex, sound_fx, is_active, position)
                VALUES (?, 'Retired', 'Gone.', 1, '{"pitch":1,"bright":0,"thump":1}', false, 900)
                """).param(plate).update();
        try {
            JsonNode body = read(mvc.perform(get("/v1/case-options"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=300, public"))
                .andExpect(header().exists(HttpHeaders.ETAG))
                .andReturn());

            assertThat(slugs(body.get("materials"))).startsWith("alu", "pc", "plastic", "wood");
            assertThat(slugs(body.get("plates"))).startsWith("alu", "brass", "fr4", "pc", "pom")
                .doesNotContain(plate);
            assertThat(slugs(body.get("mounts"))).startsWith("tray", "gasket", "top-mount");

            assertThat(json.writeValueAsString(body.at("/materials/0"))).isEqualTo("""
                    {"slug":"alu","name":"Aluminum","colors":["#C3C9D4","#2B4677","#2C2A5A","#FFD24D",\
                    "#1C1F26","#E6DFCC","#F16B53","#6B4A33"],"soundEffect":"Dense and solid. Clean, low resonance."}""");
            assertThat(json.writeValueAsString(body.at("/plates/1"))).isEqualTo("""
                    {"slug":"brass","name":"Brass","soundEffect":"Heavy and stiff. Bright, sharp and loud."}""");
            assertThat(body.at("/mounts/1/soundEffect").asString()).isEqualTo("Soft, bouncy, even.");
        }
        finally {
            jdbc.sql("DELETE FROM catalog.plates WHERE id = ?").param(plate).update();
        }
    }

    @Test
    void aMatchingIfNoneMatchGetsNotModified() throws Exception {
        for (String path : List.of("/v1/keycap-sets", "/v1/keycap-sets/sky-lab", "/v1/mods", "/v1/case-options")) {
            String etag = mvc.perform(get(path)).andExpect(status().isOk()).andReturn().getResponse()
                .getHeader(HttpHeaders.ETAG);
            mvc.perform(get(path).header(HttpHeaders.IF_NONE_MATCH, etag))
                .andExpect(status().isNotModified())
                .andExpect(header().string(HttpHeaders.ETAG, etag));
        }
    }

    private JsonNode allMods() throws Exception {
        return read(mvc.perform(get("/v1/mods").param("page_size", "100")).andExpect(status().isOk()).andReturn())
            .get("data");
    }

    private int seedCount(String table) {
        return jdbc.sql("SELECT count(*) FROM catalog." + table + " WHERE is_seed").query(Integer.class).single();
    }

    private JsonNode read(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }

    private static List<String> slugs(JsonNode items) {
        List<String> slugs = new ArrayList<>();
        items.forEach((item) -> slugs.add(item.get("slug").asString()));
        return slugs;
    }

    /** The slugs in {@code items} that belong to {@code seed}, in response order. */
    private static List<String> seedSlugs(JsonNode items, List<String> seed) {
        Set<String> wanted = Set.copyOf(seed);
        return slugs(items).stream().filter(wanted::contains).toList();
    }
}
