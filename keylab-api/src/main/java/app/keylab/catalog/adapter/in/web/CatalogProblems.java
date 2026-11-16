package app.keylab.catalog.adapter.in.web;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import app.keylab.catalog.domain.CatalogException;
import app.keylab.catalog.domain.InvalidSwitchSpecs;
import app.keylab.catalog.domain.MissingRequiredSounds;
import app.keylab.catalog.domain.SlugTaken;
import app.keylab.catalog.domain.SwitchChangedMeanwhile;
import app.keylab.catalog.domain.SwitchNotDraft;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.query.InvalidPageToken;
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
 * Catalog's domain errors as RFC 9457 problems, with the types, codes and
 * titles of api-design-v1.md (ADM-02, ADM-03, CAT-01 to CAT-04). Ordered
 * before the shared {@link ProblemAdvice}, whose catch-all would otherwise
 * answer 500.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class CatalogProblems {

    private static final Logger log = LoggerFactory.getLogger(CatalogProblems.class);

    @ExceptionHandler(CatalogException.class)
    ResponseEntity<Object> catalog(CatalogException error, HttpServletRequest request) {
        return ProblemAdvice.respond(problem(error), request);
    }

    static ApiProblem problem(CatalogException error) {
        return switch (error) {
            case SwitchNotFound notFound -> ApiProblem.of(ProblemTypes.NOT_FOUND, "switch_not_found",
                    notFound.lookup() == SwitchNotFound.Lookup.ID ? "No switch with this id" : "No switch with this name");
            case MissingRequiredSounds missing -> ApiProblem.of(ProblemTypes.CONFLICT, "missing_required_sounds",
                    "Upload the stock press and release sounds to publish.");
            case SwitchNotDraft notDraft -> ApiProblem.of(ProblemTypes.CONFLICT, "switch_not_draft",
                    "Only drafts can be deleted. Pull it from the library instead.");
            case SlugTaken taken -> ApiProblem.of(ProblemTypes.CONFLICT, "slug_taken",
                    "Another switch just took this name. Save again.");
            case SwitchChangedMeanwhile changed -> ApiProblem.of(ProblemTypes.PRECONDITION_FAILED);
            case InvalidSwitchSpecs invalid -> ApiProblem.validation(fieldErrors(invalid));
            case InvalidPageToken token -> ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_token",
                    "page_token is not a token from a previous page");
            default -> {
                log.error("No problem mapped for {}", error.getClass().getName(), error);
                yield ApiProblem.of(ProblemTypes.INTERNAL);
            }
        };
    }

    private static List<FieldError> fieldErrors(InvalidSwitchSpecs invalid) {
        return invalid.violations().stream().map((v) -> new FieldError(v.pointer(), v.code(), v.message())).toList();
    }
}
