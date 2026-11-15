package app.keylab.shared.concurrency;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

/** GET returns an ETag; a change needs If-Match with the current tag, and a stale one gets 412. */
class IfMatchTest extends IntegrationTest {

    private static final String TOKEN = StubJwks.token(Roles.USER);

    @Test
    void aChangeWithTheTagFromTheLastGetGoesThrough() throws Exception {
        String etag = getAs("/v1/probe/item", TOKEN)
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"7\""))
            .andReturn().getResponse().getHeader("ETag");

        mvc.perform(bearer(patch("/v1/probe/item"), TOKEN).header("If-Match", etag))
            .andExpect(status().isOk())
            .andExpect(header().string("ETag", "\"8\""));
    }

    @Test
    void aStaleTagIsPreconditionFailed() throws Exception {
        mvc.perform(bearer(patch("/v1/probe/item"), TOKEN).header("If-Match", "\"6\""))
            .andExpect(status().isPreconditionFailed())
            .andExpect(content().contentType("application/problem+json"))
            .andExpect(jsonPath("$.code").value("precondition_failed"))
            .andExpect(jsonPath("$.type").value("https://keylab.app/problems/precondition-failed"));
    }

    @Test
    void aMissingHeaderIsBadRequest() throws Exception {
        mvc.perform(bearer(patch("/v1/probe/item"), TOKEN))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("if_match_required"));
    }

    @Test
    void tagsCompareStrongly() {
        String current = ETags.of(7);
        assertThat(current).isEqualTo("\"7\"");
        assertThat(ETags.of("3f2a")).isEqualTo("\"3f2a\"");

        assertThatCode(() -> IfMatch.check("\"7\"", current)).doesNotThrowAnyException();
        assertThatCode(() -> IfMatch.check("\"5\", \"7\"", current)).doesNotThrowAnyException();
        assertThatCode(() -> IfMatch.check("*", current)).doesNotThrowAnyException();

        for (String stale : new String[] { "\"6\"", "7", "W/\"7\"", "\"5\", \"6\"" }) {
            assertThatThrownBy(() -> IfMatch.check(stale, current))
                .isInstanceOfSatisfying(ApiProblem.class,
                        (problem) -> assertThat(problem.type()).isEqualTo(ProblemTypes.PRECONDITION_FAILED));
        }
        for (String missing : new String[] { null, "", "  " }) {
            assertThatThrownBy(() -> IfMatch.check(missing, current))
                .isInstanceOfSatisfying(ApiProblem.class,
                        (problem) -> assertThat(problem.code()).isEqualTo("if_match_required"));
        }
        assertThatThrownBy(() -> ETags.of("has\"quote")).isInstanceOf(IllegalArgumentException.class);
    }
}
