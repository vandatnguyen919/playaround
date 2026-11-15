package app.keylab.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * US-37 through the real filter chain and Postgres: an editor creates, edits
 * and deletes a draft switch with its specs and force curve; invalid specs
 * get a 422 naming each field; drafts stay out of reach of anyone without an
 * editor role.
 */
class AdminSwitchApiTest extends IntegrationTest {

    static final String SWITCHES = "/v1/admin/switches";
    static final String MERGE_PATCH = "application/merge-patch+json";

    static final String CORAL_POP = """
            {
              "name": "Coral Pop", "brand": "Clack Works", "type": "tactile", "stemColor": "#f16b53",
              "forceG": 62, "actuationMm": 2.0, "travelMm": 3.8, "spring": "18", "photoUploadId": null,
              "forceCurve": [
                { "travelMm": 3.8, "forceG": 92 }, { "travelMm": 0, "forceG": 0 },
                { "travelMm": 0.4, "forceG": 38 }, { "travelMm": 0.8, "forceG": 76 },
                { "travelMm": 2.0, "forceG": 62, "stroke": "press" },
                { "travelMm": 2.0, "forceG": 55, "stroke": "release" }
              ]
            }
            """;

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);

    @Autowired
    JdbcClient jdbc;

    // --- Create, read, edit, delete -------------------------------------------------

    @Test
    void anEditorCreatesADraftWithSpecsAndForceCurve() throws Exception {
        MvcResult created = mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
                .content(CORAL_POP))
            .andExpect(status().isCreated())
            .andExpect(header().string("Location", startsWith("/v1/admin/switches/")))
            .andExpect(header().string("ETag", "\"1\""))
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(jsonPath("$.status").value("draft"))
            .andExpect(jsonPath("$.soundStatus").value("missing"))
            .andExpect(jsonPath("$.isNew").value(false))
            .andExpect(jsonPath("$.slug").value(startsWith("coral-pop")))
            .andExpect(jsonPath("$.name").value("Coral Pop"))
            .andExpect(jsonPath("$.brand").value("Clack Works"))
            .andExpect(jsonPath("$.type").value("tactile"))
            .andExpect(jsonPath("$.stemColor").value("#F16B53"))
            .andExpect(jsonPath("$.forceG").value(62))
            .andExpect(jsonPath("$.actuationMm").value(2))
            .andExpect(jsonPath("$.travelMm").value(3.8))
            .andExpect(jsonPath("$.spring").value("18"))
            .andExpect(jsonPath("$.publishedAt").doesNotExist())
            // Sorted press first, then by travel.
            .andExpect(jsonPath("$.forceCurve.length()").value(6))
            .andExpect(jsonPath("$.forceCurve[0].travelMm").value(0))
            .andExpect(jsonPath("$.forceCurve[0].stroke").value("press"))
            .andExpect(jsonPath("$.forceCurve[4].travelMm").value(3.8))
            .andExpect(jsonPath("$.forceCurve[5].stroke").value("release"))
            .andReturn();

        String location = created.getResponse().getHeader("Location");
        mvc.perform(asEditor(get(location)))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"1\""))
            .andExpect(jsonPath("$.id").value(location.substring(location.lastIndexOf('/') + 1)))
            .andExpect(jsonPath("$.forceCurve[1].travelMm").value(0.4))
            .andExpect(jsonPath("$.forceCurve[1].forceG").value(38));
    }

    @Test
    void anEditorEditsADraftWithMergePatchAndIfMatch() throws Exception {
        String location = create(CORAL_POP);

        mvc.perform(asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"").content("""
                { "name": "Coral Pop Pro", "brand": null, "forceG": 65,
                  "forceCurve": [ { "travelMm": 0, "forceG": 0 }, { "travelMm": 3.8, "forceG": 95 } ] }
                """))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"2\""))
            .andExpect(jsonPath("$.name").value("Coral Pop Pro"))
            .andExpect(jsonPath("$.slug").value(startsWith("coral-pop-pro")))
            .andExpect(jsonPath("$.brand").doesNotExist())
            .andExpect(jsonPath("$.forceG").value(65))
            // Fields the patch leaves out keep their value; an array is replaced whole.
            .andExpect(jsonPath("$.type").value("tactile"))
            .andExpect(jsonPath("$.travelMm").value(3.8))
            .andExpect(jsonPath("$.forceCurve.length()").value(2))
            .andExpect(jsonPath("$.forceCurve[1].forceG").value(95));

        // The first ETag is stale now.
        mvc.perform(asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"forceG\": 50 }"))
            .andExpect(status().isPreconditionFailed())
            .andExpect(jsonPath("$.code").value("precondition_failed"));
        mvc.perform(asEditor(patch(location)).contentType(MERGE_PATCH).content("{ \"forceG\": 50 }"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("if_match_required"));
        mvc.perform(asEditor(patch(location)).contentType(MediaType.APPLICATION_JSON).header("If-Match", "\"2\"")
                .content("{ \"forceG\": 50 }"))
            .andExpect(status().isUnsupportedMediaType());
        mvc.perform(asEditor(get(location))).andExpect(jsonPath("$.forceG").value(65));
    }

    @Test
    void anEditorDeletesADraft() throws Exception {
        String location = create(CORAL_POP);

        mvc.perform(asEditor(delete(location)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("if_match_required"));
        mvc.perform(asEditor(delete(location)).header("If-Match", "\"9\""))
            .andExpect(status().isPreconditionFailed());
        mvc.perform(asEditor(delete(location)).header("If-Match", "\"1\""))
            .andExpect(status().isNoContent());
        mvc.perform(asEditor(get(location)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("switch_not_found"));
    }

    @Test
    void onlyDraftsCanBeDeleted() throws Exception {
        String location = create(CORAL_POP);
        jdbc.sql("UPDATE catalog.switches SET status = 'published', published_at = now() WHERE id = ?")
            .param(UUID.fromString(id(location))).update();

        mvc.perform(asEditor(delete(location)).header("If-Match", "\"1\""))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("switch_not_draft"));
        mvc.perform(asEditor(get(location))).andExpect(status().isOk());
    }

    @Test
    void namesThatClashGetTheNextFreeSlug() throws Exception {
        String name = "Slug Clash " + UUID.randomUUID().toString().substring(0, 8);
        String body = "{ \"name\": \"" + name + "\", \"type\": \"linear\" }";
        String first = slug(create(body));
        String second = slug(create(body));
        assertThat(second).isEqualTo(first + "-2");
    }

    @Test
    void anUnknownOrMalformedIdIsNotFound() throws Exception {
        mvc.perform(asEditor(get(SWITCHES + "/" + UUID.randomUUID()))).andExpect(status().isNotFound());
        mvc.perform(asEditor(get(SWITCHES + "/coral-pop")))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("switch_not_found"));
    }

    @Test
    void aRepeatedIdempotencyKeyCreatesOneSwitch() throws Exception {
        String key = UUID.randomUUID().toString();
        String first = mvc.perform(asEditor(post(SWITCHES)).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(CORAL_POP))
            .andExpect(status().isCreated()).andReturn().getResponse().getHeader("Location");
        mvc.perform(asEditor(post(SWITCHES)).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(CORAL_POP))
            .andExpect(status().isCreated())
            .andExpect(header().string("Location", first))
            .andExpect(header().string("ETag", "\"1\""));
    }

    // --- Invalid specs ---------------------------------------------------------------

    @Test
    void invalidSpecsAre422WithAnErrorPerField() throws Exception {
        mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON).content("""
                {
                  "name": "  ", "type": "squishy", "stemColor": "coral", "forceG": "62g",
                  "actuationMm": 4.0, "travelMm": 3.8, "bottomOutG": 900,
                  "forceCurve": [
                    { "travelMm": 0.4, "forceG": 38 }, { "travelMm": 0.4, "forceG": 40 },
                    { "travelMm": 5.0, "forceG": 60 }, { "forceG": 60 }, { "travelMm": 1, "forceG": -1 },
                    { "travelMm": 1.2, "forceG": 50, "stroke": "sideways" }
                  ]
                }
                """))
            .andExpect(status().isUnprocessableContent())
            .andExpect(header().string("Content-Type", containsString("application/problem+json")))
            .andExpect(jsonPath("$.code").value("validation_failed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/name')].message").value(hasItem("Give the switch a name.")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/type')].code").value(hasItem("invalid_choice")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/stemColor')].code").value(hasItem("invalid_color")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceG')].code").value(hasItem("invalid_type")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/actuationMm')].code")
                .value(hasItem("actuation_after_travel")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/bottomOutG')].code").value(hasItem("out_of_range")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/1/travelMm')].code")
                .value(hasItem("duplicate_travel")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/2/travelMm')].message")
                .value(hasItem("Between 0 and the total travel, 3.8 mm.")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/3/travelMm')].code").value(hasItem("required")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/4/forceG')].code")
                .value(hasItem("out_of_range")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/5/stroke')].code")
                .value(hasItem("invalid_choice")))
            .andExpect(jsonPath("$.errors.length()").value(11));
    }

    @Test
    void aPatchThatBreaksTheSpecsIs422AndChangesNothing() throws Exception {
        String location = create(CORAL_POP);
        mvc.perform(asEditor(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": null, \"travelMm\": 1.5 }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[?(@.pointer == '/name')].code").value(hasItem("required")))
            // Lowering the travel below the actuation point and the curve is caught too.
            .andExpect(jsonPath("$.errors[?(@.pointer == '/actuationMm')].code")
                .value(hasItem("actuation_after_travel")))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/forceCurve/4/travelMm')]").exists());
        mvc.perform(asEditor(get(location)))
            .andExpect(header().string("ETag", "\"1\""))
            .andExpect(jsonPath("$.name").value("Coral Pop"));
    }

    @Test
    void photosAreRefusedUntilUploadsExist() throws Exception {
        mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON).content("""
                { "name": "With photo", "type": "linear", "photoUploadId": "0193f2c4-7a1e-7c5b-9d2e-4f8a1b3c5d6e" }
                """))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/photoUploadId"))
            .andExpect(jsonPath("$.errors[0].code").value("photo_upload_unavailable"));
    }

    // --- Drafts stay private -----------------------------------------------------------

    @Test
    void draftsAreForEditorsOnly() throws Exception {
        String location = create(CORAL_POP);
        String slug = slug(location);

        // Guests and members: the admin API asks for a sign-in or a team role.
        mvc.perform(get(location)).andExpect(status().isUnauthorized());
        mvc.perform(bearer(get(location), StubJwks.token(Roles.USER))).andExpect(status().isForbidden());
        // A viewer may look at the admin dashboard but not at switch editing.
        mvc.perform(bearer(get(location), StubJwks.token(Roles.USER, Roles.VIEWER)))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("forbidden"));
        mvc.perform(bearer(post(SWITCHES), StubJwks.token(Roles.USER, Roles.VIEWER))
                .contentType(MediaType.APPLICATION_JSON).content(CORAL_POP))
            .andExpect(status().isForbidden());

        // The public library has no way to a draft: no anonymous switch route answers.
        mvc.perform(get("/v1/switches")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/switches/" + slug)).andExpect(status().isUnauthorized());
        assertThat(jdbc.sql("SELECT status FROM catalog.switches WHERE slug = ?").param(slug)
            .query(String.class).single()).isEqualTo("draft");
    }

    // --- Helpers -----------------------------------------------------------------------

    MockHttpServletRequestBuilder asEditor(MockHttpServletRequestBuilder request) {
        return bearer(request, editor);
    }

    String create(String body) throws Exception {
        ResultActions result = mvc.perform(asEditor(post(SWITCHES)).contentType(MediaType.APPLICATION_JSON)
                .content(body)).andExpect(status().isCreated());
        return result.andReturn().getResponse().getHeader("Location");
    }

    String slug(String location) throws Exception {
        String body = mvc.perform(asEditor(get(location))).andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(body, "$.slug");
    }

    static String id(String location) {
        return location.substring(location.lastIndexOf('/') + 1);
    }
}
