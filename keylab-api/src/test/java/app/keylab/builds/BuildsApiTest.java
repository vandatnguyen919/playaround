package app.keylab.builds;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
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
import app.keylab.testing.TestTokens;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-08 through the real filter chain and Postgres: a member saves a build
 * (BLD-02, Idempotency-Key, private by default), renames it with JSON Merge
 * Patch and If-Match (BLD-04, a stale tag is 412), and lists public and
 * private builds (BLD-01). Parts come from the KL2-1 seed and a switch of
 * the test's own. Each test signs in as a new member, so lists start empty.
 * US-12: the visibility toggle (BLD-04 with If-Match), delete (BLD-05 with
 * If-Match), the build's link (BLD-03) and the events the profile's
 * daily-driver pin listens to.
 */
@RecordApplicationEvents
class BuildsApiTest extends IntegrationTest {

    static final String BUILDS = "/v1/builds";
    static final String MY_BUILDS = "/v1/me/builds";
    static final String MERGE_PATCH = "application/merge-patch+json";

    final String editor = StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR);
    String member;
    String switchSlug;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    JsonMapper json;

    @Autowired
    ApplicationEvents events;

    @BeforeEach
    void newMemberAndSwitch() throws Exception {
        member = memberToken(UUID.randomUUID());
        switchSlug = publishedSwitch();
    }

    // --- BLD-02 save --------------------------------------------------------------------

    @Test
    void aMemberSavesABuildThatStartsPrivateWithItsSound() throws Exception {
        MvcResult created = mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", UUID.randomUUID().toString()).content(nightThock(null)))
            .andExpect(status().isCreated())
            .andExpect(header().string("Location", startsWith("/v1/builds/")))
            .andExpect(header().string("ETag", "\"1\""))
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(jsonPath("$.name").value("Night Thock 65"))
            .andExpect(jsonPath("$.visibility").value("private"))
            .andExpect(jsonPath("$.owner.username").value("me"))
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.likeCount").value(0))
            .andExpect(jsonPath("$.layout").value("65"))
            .andExpect(jsonPath("$.switch.slug").value(switchSlug))
            .andExpect(jsonPath("$.switch.variant").value("lubed"))
            .andExpect(jsonPath("$.mods.length()").value(3))
            .andExpect(jsonPath("$.mods[0].slug").value("lube"))
            .andExpect(jsonPath("$.mods[0].level").value("light"))
            .andExpect(jsonPath("$.mods[1].slug").value("case-foam"))
            .andExpect(jsonPath("$.mods[1].level").doesNotExist())
            // Profile and material come from the catalog's set, whatever the client sent.
            .andExpect(jsonPath("$.keycaps.set").value("navy-sun"))
            .andExpect(jsonPath("$.keycaps.profile").value("cherry"))
            .andExpect(jsonPath("$.keycaps.material").value("pbt"))
            .andExpect(jsonPath("$.case.material").value("alu"))
            .andExpect(jsonPath("$.case.color").value("#2B4677"))
            .andExpect(jsonPath("$.case.plate").value("brass"))
            .andExpect(jsonPath("$.case.mount").value("gasket"))
            .andExpect(jsonPath("$.deskPad").value("sky"))
            .andExpect(jsonPath("$.createdAt").exists())
            .andReturn();

        UUID id = idOf(created);
        // Version 1 holds the parts and the recipe's sound (config.sound), computed by BLD-10's code.
        JsonNode config = json.readTree(jdbc.sql("SELECT config::text FROM builds.build_versions WHERE build_id = ?")
            .param(id).query(String.class).single());
        assertThat(config.at("/sound/meter/word").asString()).isNotBlank();
        assertThat(config.at("/sound/reverbMix").isNumber()).isTrue();
        assertThat(jdbc.sql("SELECT version_no FROM builds.build_versions WHERE build_id = ?").param(id)
            .query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void aBuildAskedPublicStartsPublic() throws Exception {
        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content(nightThock("public")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.visibility").value("public"));
    }

    @Test
    void aReplayedIdempotencyKeyReturnsTheFirstBuildAndSavesNothingNew() throws Exception {
        String key = UUID.randomUUID().toString();
        MvcResult first = mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", key).content(nightThock(null)))
            .andExpect(status().isCreated()).andReturn();
        MvcResult replay = mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", key).content(nightThock(null)))
            .andExpect(status().isCreated())
            .andExpect(header().string("ETag", "\"1\"")).andReturn();

        assertThat(replay.getResponse().getHeader("Location")).isEqualTo(first.getResponse().getHeader("Location"));
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(first.getResponse().getContentAsString());
        mvc.perform(asMember(get(MY_BUILDS))).andExpect(jsonPath("$.data.length()").value(1));

        // The same key with another body is refused.
        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", key).content(nightThock("public")))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("idempotency_key_reused"));
    }

    @Test
    void everyFieldToFixComesInOne422() throws Exception {
        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content("""
                { "name": "  ", "visibility": "unlisted", "layout": "40",
                  "switch": { "slug": "%s", "variant": "silent" },
                  "mods": [ { "slug": "case-foam" }, { "slug": "case-foam" } ],
                  "case": { "color": "navy" } }
                """.formatted(switchSlug)))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("validation_failed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/name')].code").value("required"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/visibility')].code").value("not_allowed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/layout')].code").value("not_allowed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/switch/variant')].code").value("not_allowed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/mods/1')].code").value("duplicate"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/case/color')].code").value("invalid_color"));

        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"name\": \"" + "x".repeat(61) + "\", \"layout\": \"65\", \"switch\": { \"slug\": \""
                        + switchSlug + "\" } }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/name"))
            .andExpect(jsonPath("$.errors[0].code").value("too_long"));

        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON)
                .content("{ \"name\": 7, \"layout\": \"65\", \"mods\": {} }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[?(@.pointer == '/name')].code").value("invalid_type"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/mods')].code").value("invalid_type"));
    }

    @Test
    void partsMustBeOfferedTodayAndModsNeedALevelTheyOffer() throws Exception {
        // A draft keycap set (lime-pop) and an unknown switch never existed for builders.
        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content("""
                { "name": "Ghost", "layout": "65", "switch": { "slug": "no-such-switch" },
                  "keycaps": { "set": "lime-pop" } }
                """))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("part_not_found"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/switch/slug')].code").value("part_not_found"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/keycaps/set')].code").value("part_not_found"));

        // A hidden set (ink-blank) and a switched-off mod (holee-mod) still play in old builds, but are not offered.
        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content("""
                { "name": "Retired", "layout": "65", "switch": { "slug": "%s" },
                  "mods": [ { "slug": "case-foam" }, { "slug": "holee-mod" } ], "keycaps": { "set": "ink-blank" } }
                """.formatted(switchSlug)))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("part_retired"))
            .andExpect(jsonPath("$.errors.length()").value(2))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/mods/1')].code").value("part_retired"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/keycaps/set')].code").value("part_retired"));

        mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content("""
                { "name": "Levels", "layout": "65", "switch": { "slug": "%s" },
                  "mods": [ { "slug": "lube" }, { "slug": "spring-swap", "level": "extra" } ] }
                """.formatted(switchSlug)))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("validation_failed"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/mods/0')].code").value("level_required"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/mods/1')].code").value("level_not_offered"));
        mvc.perform(asMember(get(MY_BUILDS))).andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void guestsCannotSaveOrList() throws Exception {
        mvc.perform(post(BUILDS).contentType(MediaType.APPLICATION_JSON).content(nightThock(null)))
            .andExpect(status().isUnauthorized());
        mvc.perform(get(MY_BUILDS)).andExpect(status().isUnauthorized());
    }

    // --- BLD-04 rename ------------------------------------------------------------------

    @Test
    void aMemberRenamesWithIfMatchAndAStaleTagGets412() throws Exception {
        String location = create(nightThock(null));

        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"  Night Thock Mk II  \" }"))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"2\""))
            .andExpect(jsonPath("$.name").value("Night Thock Mk II"))
            .andExpect(jsonPath("$.version").value(2))
            // Everything else stays.
            .andExpect(jsonPath("$.visibility").value("private"))
            .andExpect(jsonPath("$.switch.slug").value(switchSlug))
            .andExpect(jsonPath("$.mods.length()").value(3))
            .andExpect(jsonPath("$.case.plate").value("brass"));

        // Someone else renamed it first: the first tag is stale.
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"Lost update\" }"))
            .andExpect(status().isPreconditionFailed())
            .andExpect(jsonPath("$.code").value("precondition_failed"));
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).content("{ \"name\": \"No tag\" }"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("if_match_required"));
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"name\": \"\" }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.errors[0].pointer").value("/name"));

        // A rename writes no new version of the parts.
        UUID id = UUID.fromString(location.substring(location.lastIndexOf('/') + 1));
        assertThat(versions(id)).isEqualTo(1);
        mvc.perform(asMember(get(MY_BUILDS)))
            .andExpect(jsonPath("$.data[0].name").value("Night Thock Mk II"))
            .andExpect(jsonPath("$.data[0].version").value(2));
    }

    @Test
    void newPartsAddAVersionAndTheSamePartsDoNot() throws Exception {
        String location = create(nightThock(null));
        UUID id = UUID.fromString(location.substring(location.lastIndexOf('/') + 1));

        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"mods\": [ { \"slug\": \"o-rings\" } ], \"case\": { \"plate\": \"pc\" } }"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.mods.length()").value(1))
            .andExpect(jsonPath("$.mods[0].slug").value("o-rings"))
            .andExpect(jsonPath("$.case.plate").value("pc"))
            .andExpect(jsonPath("$.case.mount").value("gasket"));
        assertThat(versions(id)).isEqualTo(2);

        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"case\": { \"plate\": \"pc\" } }"))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"2\""));
        assertThat(versions(id)).isEqualTo(2);

        // A retired part is refused on edit too, and nothing changes.
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"keycaps\": { \"set\": \"ink-blank\" } }"))
            .andExpect(status().isUnprocessableContent())
            .andExpect(jsonPath("$.code").value("part_retired"));
        assertThat(versions(id)).isEqualTo(2);
    }

    @Test
    void someoneElsesBuildOrAnUnknownOneIs404() throws Exception {
        String location = create(nightThock(null));
        String other = memberToken(UUID.randomUUID());

        mvc.perform(bearer(patch(location), other).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"Mine now\" }"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("build_not_found"));
        mvc.perform(asMember(patch(BUILDS + "/" + UUID.randomUUID())).contentType(MERGE_PATCH)
                .header("If-Match", "\"1\"").content("{ \"name\": \"Nope\" }"))
            .andExpect(status().isNotFound());
        mvc.perform(asMember(patch(BUILDS + "/not-a-uuid")).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"Nope\" }"))
            .andExpect(status().isNotFound());
    }

    // --- US-12 visibility and delete ---------------------------------------------------

    @Test
    void theVisibilityToggleNeedsTheCurrentTagAndAnnouncesTheChange() throws Exception {
        String location = create(nightThock(null));
        UUID id = UUID.fromString(location.substring(location.lastIndexOf('/') + 1));

        // Private: the link is the owner's only.
        mvc.perform(get(location)).andExpect(status().isNotFound());
        mvc.perform(asMember(get(location))).andExpect(status().isOk())
            .andExpect(jsonPath("$.owner.username").value("me"))
            .andExpect(header().string("Cache-Control", containsString("private")));
        assertThat(events.stream(BuildPublished.class)).isEmpty();

        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"visibility\": \"public\" }"))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"2\""))
            .andExpect(jsonPath("$.visibility").value("public"));
        assertThat(events.stream(BuildPublished.class)).containsExactly(new BuildPublished(id, ownerOf(id), 1));
        assertThat(versions(id)).isEqualTo(1);

        // Public: guests and other members open the link too.
        mvc.perform(get(location)).andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Night Thock 65"))
            .andExpect(jsonPath("$.owner.username").value("member"))
            .andExpect(header().string("ETag", "\"2\""))
            .andExpect(header().string("Cache-Control", containsString("no-cache")));
        mvc.perform(bearer(get(location), memberToken(UUID.randomUUID()))).andExpect(status().isOk());

        // Back to private with a stale tag: 412, and it stays public.
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"visibility\": \"private\" }"))
            .andExpect(status().isPreconditionFailed());
        mvc.perform(get(location)).andExpect(status().isOk());

        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"visibility\": \"private\" }"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.visibility").value("private"));
        assertThat(events.stream(BuildWithdrawn.class))
            .containsExactly(new BuildWithdrawn(id, ownerOf(id), BuildWithdrawn.Reason.PRIVATE));
        mvc.perform(get(location)).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("build_not_found"));
    }

    @Test
    void deleteNeedsTheCurrentTagAndTheOldLinkIs404Afterwards() throws Exception {
        String location = create(nightThock("public"));
        UUID id = UUID.fromString(location.substring(location.lastIndexOf('/') + 1));
        mvc.perform(get(location)).andExpect(status().isOk());

        mvc.perform(asMember(delete(location))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("if_match_required"));
        mvc.perform(asMember(delete(location)).header("If-Match", "\"9\""))
            .andExpect(status().isPreconditionFailed());
        mvc.perform(bearer(delete(location), memberToken(UUID.randomUUID())).header("If-Match", "\"1\""))
            .andExpect(status().isNotFound());
        mvc.perform(delete(location).header("If-Match", "\"1\"")).andExpect(status().isUnauthorized());
        assertThat(events.stream(BuildWithdrawn.class)).isEmpty();
        mvc.perform(get(location)).andExpect(status().isOk());

        mvc.perform(asMember(delete(location)).header("If-Match", "\"1\"")).andExpect(status().isNoContent());
        assertThat(events.stream(BuildWithdrawn.class))
            .containsExactly(new BuildWithdrawn(id, ownerOf(id), BuildWithdrawn.Reason.DELETED));

        // Gone everywhere at once: the old link (guest and owner), My builds, edits, a second delete.
        mvc.perform(get(location)).andExpect(status().isNotFound());
        mvc.perform(asMember(get(location))).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("build_not_found"));
        mvc.perform(asMember(get(MY_BUILDS))).andExpect(jsonPath("$.data.length()").value(0));
        mvc.perform(asMember(patch(location)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"name\": \"Back\" }"))
            .andExpect(status().isNotFound());
        mvc.perform(asMember(delete(location)).header("If-Match", "\"2\"")).andExpect(status().isNotFound());
        // Soft: the row stays, marked deleted.
        assertThat(jdbc.sql("SELECT deleted_at IS NOT NULL FROM builds.builds WHERE id = ?").param(id)
            .query(Boolean.class).single()).isTrue();
    }

    @Test
    void aDeletedPrivateBuildIsAnnouncedAndPublicChangesArePublished() throws Exception {
        String priv = create(nightThock(null));
        UUID privId = UUID.fromString(priv.substring(priv.lastIndexOf('/') + 1));
        mvc.perform(asMember(delete(priv)).header("If-Match", "\"1\"")).andExpect(status().isNoContent());
        assertThat(events.stream(BuildWithdrawn.class))
            .containsExactly(new BuildWithdrawn(privId, ownerOf(privId), BuildWithdrawn.Reason.DELETED));

        String pub = create(nightThock("public"));
        UUID pubId = UUID.fromString(pub.substring(pub.lastIndexOf('/') + 1));
        assertThat(events.stream(BuildPublished.class)).containsExactly(new BuildPublished(pubId, ownerOf(pubId), 1));
        // A rename alone announces nothing; new parts on a public build publish the new version.
        mvc.perform(asMember(patch(pub)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"Renamed\" }")).andExpect(status().isOk());
        assertThat(events.stream(BuildPublished.class)).hasSize(1);
        mvc.perform(asMember(patch(pub)).contentType(MERGE_PATCH).header("If-Match", "\"2\"")
                .content("{ \"mods\": [] }")).andExpect(status().isOk());
        assertThat(events.stream(BuildPublished.class)).last().isEqualTo(new BuildPublished(pubId, ownerOf(pubId), 2));
    }

    // --- BLD-01 list --------------------------------------------------------------------

    @Test
    void myBuildsListsPublicAndPrivateNewestFirstAndOnlyMine() throws Exception {
        String firstCreated = create(nightThock(null).replace("Night Thock 65", "First private"));
        create(nightThock("public").replace("Night Thock 65", "Second public"));
        String third = create(nightThock(null).replace("Night Thock 65", "Third private"));
        mvc.perform(bearer(post(BUILDS), memberToken(UUID.randomUUID())).contentType(MediaType.APPLICATION_JSON)
                .content(nightThock("public").replace("Night Thock 65", "Not mine")))
            .andExpect(status().isCreated());

        mvc.perform(asMember(get(MY_BUILDS)))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(jsonPath("$.data.length()").value(3))
            .andExpect(jsonPath("$.data[0].name").value("Third private"))
            .andExpect(jsonPath("$.data[1].name").value("Second public"))
            .andExpect(jsonPath("$.data[1].visibility").value("public"))
            .andExpect(jsonPath("$.data[2].name").value("First private"))
            .andExpect(jsonPath("$.data[2].visibility").value("private"))
            .andExpect(jsonPath("$.page.nextPageToken").doesNotExist())
            .andExpect(jsonPath("$.page.pageSize").value(24));

        mvc.perform(asMember(get(MY_BUILDS)).param("visibility", "public"))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].name").value("Second public"));
        mvc.perform(asMember(get(MY_BUILDS)).param("visibility", "private"))
            .andExpect(jsonPath("$.data.length()").value(2));

        // A rename moves the build to the top of "newest change first", not of "newest created first".
        mvc.perform(asMember(patch(firstCreated)).contentType(MERGE_PATCH).header("If-Match", "\"1\"")
                .content("{ \"name\": \"First, renamed\" }"))
            .andExpect(status().isOk());
        assertThat(firstId(mvc.perform(asMember(get(MY_BUILDS))).andReturn()))
            .isEqualTo(firstCreated.substring(firstCreated.lastIndexOf('/') + 1));
        assertThat(firstId(mvc.perform(asMember(get(MY_BUILDS)).param("sort", "-createdAt")).andReturn()))
            .isEqualTo(third.substring(third.lastIndexOf('/') + 1));
    }

    @Test
    void myBuildsPagesByCursorWithNoRepeats() throws Exception {
        for (int i = 1; i <= 3; i++) {
            create(nightThock(null).replace("Night Thock 65", "Paged " + i));
        }
        MvcResult one = mvc.perform(asMember(get(MY_BUILDS)).param("page_size", "2"))
            .andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.data[0].name").value("Paged 3"))
            .andExpect(jsonPath("$.page.pageSize").value(2))
            .andReturn();
        String token = json.readTree(one.getResponse().getContentAsString()).at("/page/nextPageToken").asString();
        mvc.perform(asMember(get(MY_BUILDS)).param("page_size", "2").param("page_token", token))
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].name").value("Paged 1"))
            .andExpect(jsonPath("$.page.nextPageToken").doesNotExist());

        mvc.perform(asMember(get(MY_BUILDS)).param("sort", "-createdAt").param("page_token", token))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_page_token"));
        mvc.perform(asMember(get(MY_BUILDS)).param("visibility", "unlisted"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_parameter"));
        mvc.perform(asMember(get(MY_BUILDS)).param("sort", "name"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_parameter"));
    }

    // --- Helpers ------------------------------------------------------------------------

    /** The BuildInput example of openapi-v1.yaml, with seed parts and the test's switch. */
    String nightThock(String visibility) {
        return """
                { "name": "Night Thock 65", %s "layout": "65",
                  "switch": { "slug": "%s", "variant": "lubed" },
                  "mods": [ { "slug": "lube", "level": "light" }, { "slug": "case-foam" }, { "slug": "stabs" } ],
                  "keycaps": { "set": "navy-sun", "profile": "sa", "material": "abs" },
                  "case": { "material": "alu", "color": "#2b4677", "plate": "brass", "mount": "gasket" },
                  "deskPad": "sky" }
                """.formatted(visibility == null ? "" : "\"visibility\": \"" + visibility + "\",", switchSlug);
    }

    String create(String body) throws Exception {
        MvcResult created = mvc.perform(asMember(post(BUILDS)).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn();
        return created.getResponse().getHeader("Location");
    }

    UUID idOf(MvcResult result) throws Exception {
        return UUID.fromString(json.readTree(result.getResponse().getContentAsString()).get("id").asString());
    }

    String firstId(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString()).at("/data/0/id").asString();
    }

    UUID ownerOf(UUID buildId) {
        return jdbc.sql("SELECT owner_id FROM builds.builds WHERE id = ?").param(buildId).query(UUID.class).single();
    }

    int versions(UUID buildId) {
        return jdbc.sql("SELECT count(*) FROM builds.build_versions WHERE build_id = ?").param(buildId)
            .query(Integer.class).single();
    }

    MockHttpServletRequestBuilder asMember(MockHttpServletRequestBuilder request) {
        return bearer(request, member);
    }

    static String memberToken(UUID subject) {
        return TestTokens.sign(StubJwks.KEY, StubJwks.claims(Roles.USER).subject(subject.toString()).build());
    }

    /** A published switch with its stock takes, as an editor makes one (US-37, US-39). */
    String publishedSwitch() throws Exception {
        String name = "Build " + UUID.randomUUID().toString().substring(0, 8);
        MvcResult created = mvc.perform(bearer(post("/v1/admin/switches"), editor)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{ \"name\": \"" + name + "\", \"brand\": \"Build Works\", \"type\": \"linear\", "
                        + "\"profile\": \"deep\" }"))
            .andExpect(status().isCreated()).andReturn();
        JsonNode sw = json.readTree(created.getResponse().getContentAsString());
        UUID id = UUID.fromString(sw.get("id").asString());
        jdbc.sql("UPDATE catalog.switches SET sound_status = 'recorded' WHERE id = ?").param(id).update();
        mvc.perform(bearer(post("/v1/admin/switches/" + id + "/publication"), editor)
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk());
        for (String stroke : new String[] { "press", "release" }) {
            jdbc.sql("""
                    INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms,
                      loudness_lufs, peaks, processed_at)
                    VALUES (?, 'stock', ?, ?, ?, 180, -14.5, '[0.1,0.8,0.3]', now())
                    """)
                .params(id, stroke, UUID.randomUUID(), "/bff/keylab/v1/assets/sounds/stock-" + stroke + ".wav")
                .update();
        }
        return sw.get("slug").asString();
    }
}
