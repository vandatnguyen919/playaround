package app.keylab.shared.problem;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.keylab.shared.security.Roles;
import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;

import org.junit.jupiter.api.Test;

import org.springframework.test.web.servlet.ResultActions;

/**
 * Errors are application/problem+json (RFC 9457) with a stable code, 422
 * lists each field, and every response carries KeyLab-API-Revision.
 */
class ProblemFormatTest extends IntegrationTest {

    private static final String TOKEN = StubJwks.token(Roles.USER);

    @Test
    void validationErrorsListEachFieldWithAJsonPointer() throws Exception {
        problem(mvc.perform(bearer(post("/v1/probe/validated"), TOKEN)
                .contentType("application/json")
                .content("{\"username\":\"much-too-long\",\"links\":{\"website\":\"\"}}")), 422, "validation_failed")
            .andExpect(jsonPath("$.type").value("https://keylab.app/problems/validation"))
            .andExpect(jsonPath("$.title").value("Some fields need a fix"))
            .andExpect(jsonPath("$.errors.length()").value(2))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/username')].code").value("size"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/links/website')].code").value("not_blank"))
            .andExpect(jsonPath("$.errors[?(@.pointer == '/links/website')].message").exists());
    }

    @Test
    void aValidBodyPasses() throws Exception {
        mvc.perform(bearer(post("/v1/probe/validated"), TOKEN)
                .contentType("application/json")
                .content("{\"username\":\"clack\",\"links\":{\"website\":\"https://example.com\"}}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("clack"));
    }

    @Test
    void aModuleProblemKeepsItsCodeAndTitle() throws Exception {
        problem(getAs("/v1/probe/conflict", TOKEN), 409, "missing_required_sounds")
            .andExpect(jsonPath("$.type").value("https://keylab.app/problems/conflict"))
            .andExpect(jsonPath("$.title").value("Record the stock sounds first"))
            .andExpect(jsonPath("$.instance").value("/v1/probe/conflict"))
            .andExpect(jsonPath("$.errors").doesNotExist());
    }

    @Test
    void malformedJsonIsBadRequest() throws Exception {
        problem(mvc.perform(bearer(post("/v1/probe/validated"), TOKEN)
                .contentType("application/json").content("{not json")), 400, "bad_request");
    }

    @Test
    void anUnknownPathIsNotFound() throws Exception {
        problem(getAs("/v1/no-such-thing", TOKEN), 404, "not_found");
    }

    @Test
    void aWrongMethodIsMethodNotAllowed() throws Exception {
        problem(mvc.perform(bearer(delete("/v1/probe"), TOKEN)), 405, "method_not_allowed")
            .andExpect(header().string("Allow", containsString("GET")));
    }

    @Test
    void aWrongContentTypeIsUnsupportedMediaType() throws Exception {
        problem(mvc.perform(bearer(post("/v1/probe/validated"), TOKEN)
                .contentType("text/plain").content("hello")), 415, "unsupported_media_type");
    }

    @Test
    void anUnexpectedErrorTellsTheClientNothingAboutTheCause() throws Exception {
        problem(getAs("/v1/probe/boom", TOKEN), 500, "internal_error")
            .andExpect(content().string(not(containsString("secret internal detail"))))
            .andExpect(content().string(not(containsString("jdbc"))))
            .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

    @Test
    void successfulAndActuatorResponsesCarryTheRevisionToo() throws Exception {
        getAs("/v1/probe", TOKEN).andExpect(header().string("KeyLab-API-Revision", "2026-11-08"));
        mvc.perform(get("/v1/health")).andExpect(header().string("KeyLab-API-Revision", "2026-11-08"));
        mvc.perform(get("/actuator/health"))
            .andExpect(status().isOk())
            .andExpect(header().string("KeyLab-API-Revision", "2026-11-08"));
    }

    private static ResultActions problem(ResultActions result, int status, String code) throws Exception {
        return result
            .andExpect(status().is(status))
            .andExpect(content().contentType("application/problem+json"))
            .andExpect(jsonPath("$.type").exists())
            .andExpect(jsonPath("$.title").isNotEmpty())
            .andExpect(jsonPath("$.status").value(status))
            .andExpect(jsonPath("$.code").value(code))
            .andExpect(header().string("KeyLab-API-Revision", "2026-11-08"));
    }
}
