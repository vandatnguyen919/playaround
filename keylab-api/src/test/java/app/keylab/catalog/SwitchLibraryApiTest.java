package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
 * US-02: the public library filters by type, sound profile, sound status,
 * search and force, pages by cursor 24 at a time, and refuses filters it does
 * not know. Each test works on switches of its own brand, found with
 * {@code q}, so other tests' switches never get in the way.
 */
class SwitchLibraryApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String LIBRARY = "/v1/switches";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    @Test
    void pagesTwentyFourAtATimeByCursorWithoutRepeats() throws Exception {
        String brand = brand();
        for (int i = 0; i < 26; i++) {
            published(brand, "Page " + i, "linear", "deep", 40 + i);
        }
        JsonNode first = list("q", brand);
        assertThat(first.get("data")).hasSize(24);
        assertThat(first.at("/page/pageSize").asInt()).isEqualTo(24);
        String token = first.at("/page/nextPageToken").asString();
        assertThat(token).isNotBlank();

        JsonNode second = list("q", brand, "page_token", token);
        assertThat(second.get("data")).hasSize(2);
        assertThat(second.at("/page/nextPageToken").isNull()).isTrue();

        Set<String> ids = new HashSet<>();
        first.get("data").forEach((sw) -> ids.add(sw.get("id").asString()));
        second.get("data").forEach((sw) -> ids.add(sw.get("id").asString()));
        assertThat(ids).hasSize(26);

        // Sorted by force, lightest first, across pages too.
        JsonNode byForce = list("q", brand, "sort", "force", "page_size", "10");
        assertThat(byForce.at("/data/0/forceG").asInt()).isEqualTo(40);
        JsonNode byForce2 = list("q", brand, "sort", "force", "page_size", "10", "page_token",
                byForce.at("/page/nextPageToken").asString());
        assertThat(byForce2.at("/data/0/forceG").asInt()).isEqualTo(50);

        // A token from one sort is no good for another.
        mvc.perform(get(LIBRARY).param("q", brand).param("page_token", token).param("sort", "force"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_token"));
    }

    @Test
    void filtersByTypeProfileSoundSearchAndForce() throws Exception {
        String brand = brand();
        published(brand, "Milk Yellow", "linear", "deep", 50);
        published(brand, "Coral Pop", "tactile", "poppy", 62);
        published(brand, "Click Blue", "clicky", "clacky", 60);
        String proto = published(brand, "Proto Orange", "tactile", "poppy", 67);
        // A published switch whose recordings went away again counts as "missing".
        jdbc.sql("UPDATE catalog.switches SET sound_status = 'missing' WHERE id = ?").param(UUID.fromString(proto))
            .update();

        assertThat(names("q", brand)).containsExactlyInAnyOrder("Milk Yellow", "Coral Pop", "Click Blue",
                "Proto Orange");
        assertThat(names("q", brand, "type", "tactile")).containsExactlyInAnyOrder("Coral Pop", "Proto Orange");
        assertThat(names("q", brand, "profile", "deep")).containsExactly("Milk Yellow");
        assertThat(names("q", brand, "sound", "recorded")).containsExactlyInAnyOrder("Milk Yellow", "Coral Pop",
                "Click Blue");
        assertThat(names("q", brand, "sound", "missing")).containsExactly("Proto Orange");
        assertThat(names("q", brand, "type", "tactile", "sound", "recorded")).containsExactly("Coral Pop");
        assertThat(names("q", brand, "force_max", "50")).containsExactly("Milk Yellow");
        assertThat(names("q", brand, "force_min", "50.1", "force_max", "62")).containsExactlyInAnyOrder("Coral Pop",
                "Click Blue");
        assertThat(names("q", brand, "force_min", "62.1")).containsExactly("Proto Orange");
        // Search looks at name and brand, ignoring case, and treats % and _ as plain text.
        assertThat(names("q", "CORAL POP", "type", "tactile", "page_size", "100")).contains("Coral Pop");
        assertThat(names("q", brand.toUpperCase())).hasSize(4);
        assertThat(names("q", brand + "%")).isEmpty();

        // Nothing matches: an empty page, not an error.
        JsonNode none = list("q", brand, "type", "silent");
        assertThat(none.get("data")).isEmpty();
        assertThat(none.at("/page/nextPageToken").isNull()).isTrue();
    }

    @Test
    void refusesFilterValuesItDoesNotKnow() throws Exception {
        for (String[] bad : List.of(new String[] { "type", "membrane" }, new String[] { "profile", "loud" },
                new String[] { "sound", "maybe" }, new String[] { "is_new", "yes" },
                new String[] { "force_min", "heavy" }, new String[] { "force_max", "-1" },
                new String[] { "sort", "name" }, new String[] { "q", "x".repeat(61) })) {
            mvc.perform(get(LIBRARY).param(bad[0], bad[1]))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_parameter"));
        }
        mvc.perform(get(LIBRARY).param("page_size", "101")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_size"));
        mvc.perform(get(LIBRARY).param("page_token", "garbage")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_token"));
    }

    // --- Helpers ------------------------------------------------------------------------

    static String brand() {
        return "Brand" + UUID.randomUUID().toString().substring(0, 8);
    }

    MockHttpServletRequestBuilder asEditor(MockHttpServletRequestBuilder request) {
        return bearer(request, editor);
    }

    /** A published switch with its stock sounds; the sound status is set directly to keep this fast. */
    String published(String brand, String name, String type, String profile, int force) throws Exception {
        String body = """
                { "name": "%s", "brand": "%s", "type": "%s", "profile": "%s", "stemColor": "#F16B53",
                  "forceG": %d, "actuationMm": 2.0, "travelMm": 3.8 }
                """.formatted(name, brand, type, profile, force);
        MvcResult created = mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn();
        String id = json.readTree(created.getResponse().getContentAsString()).get("id").asString();
        jdbc.sql("UPDATE catalog.switches SET sound_status = 'recorded' WHERE id = ?").param(UUID.fromString(id))
            .update();
        mvc.perform(asEditor(post(SWITCHES + "/" + id + "/publication")).contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk());
        return id;
    }

    JsonNode list(String... params) throws Exception {
        MockHttpServletRequestBuilder request = get(LIBRARY);
        for (int i = 0; i < params.length; i += 2) {
            request.param(params[i], params[i + 1]);
        }
        MvcResult result = mvc.perform(request).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    List<String> names(String... params) throws Exception {
        List<String> names = new ArrayList<>();
        list(params).get("data").forEach((sw) -> names.add(sw.get("name").asString()));
        return names;
    }
}
