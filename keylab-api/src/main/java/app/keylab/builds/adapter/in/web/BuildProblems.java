package app.keylab.builds.adapter.in.web;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import app.keylab.builds.domain.BuildChangedMeanwhile;
import app.keylab.builds.domain.BuildNotFound;
import app.keylab.builds.domain.BuildsException;
import app.keylab.builds.domain.InvalidBuild;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.FieldError;
import app.keylab.shared.problem.ProblemAdvice;
import app.keylab.shared.problem.ProblemTypes;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Builds' domain errors as RFC 9457 problems (BLD-01 to BLD-04). Ordered
 * before the shared {@link ProblemAdvice}, whose catch-all would otherwise
 * answer 500.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class BuildProblems {

    private static final Logger log = LoggerFactory.getLogger(BuildProblems.class);

    @ExceptionHandler(BuildsException.class)
    ResponseEntity<Object> builds(BuildsException error, HttpServletRequest request) {
        return ProblemAdvice.respond(problem(error), request);
    }

    static ApiProblem problem(BuildsException error) {
        return switch (error) {
            case BuildNotFound notFound -> ApiProblem.of(ProblemTypes.NOT_FOUND, "build_not_found",
                    "No build with this id");
            case BuildChangedMeanwhile changed -> ApiProblem.of(ProblemTypes.PRECONDITION_FAILED);
            case InvalidBuild invalid -> invalid(invalid);
            default -> {
                log.error("No problem mapped for {}", error.getClass().getName(), error);
                yield ApiProblem.of(ProblemTypes.INTERNAL);
            }
        };
    }

    /**
     * 422 with one entry per field. When every bad field shares one reason
     * that belongs to the parts (part_not_found, part_retired, level_required,
     * level_not_offered), that reason is the code, as BLD-10 does.
     */
    private static ApiProblem invalid(InvalidBuild invalid) {
        List<FieldError> errors = invalid.violations().stream()
            .map((v) -> new FieldError(v.pointer(), v.code(), v.message()))
            .toList();
        List<String> codes = errors.stream().map(FieldError::code).distinct().toList();
        if (codes.size() == 1) {
            String title = switch (codes.get(0)) {
                case "part_not_found" -> "A part in this build does not exist";
                case "part_retired" -> "A part in this build is no longer offered";
                case "level_required" -> "Pick a level for this mod";
                case "level_not_offered" -> "This mod does not offer that level";
                default -> null;
            };
            if (title != null) {
                return ApiProblem.validation(codes.get(0), title, errors);
            }
        }
        return ApiProblem.validation(errors);
    }
}
