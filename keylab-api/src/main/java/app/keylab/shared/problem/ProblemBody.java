package app.keylab.shared.problem;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/** The RFC 9457 body, as the Problem schema in openapi-v1.yaml. */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ProblemBody(String type, String title, int status, String code, String detail, String instance,
        List<FieldError> errors) {

    static ProblemBody of(ApiProblem problem, String instance) {
        return new ProblemBody(problem.type().uri(), problem.title(), problem.type().status().value(),
                problem.code(), problem.detail(), instance, problem.errors());
    }
}
