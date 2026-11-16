package app.keylab.shared.problem;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Every error leaves as application/problem+json (RFC 9457) with a stable
 * {@code code}: ApiProblem from module code, bean validation as 422 with one
 * entry per field, Spring MVC's own errors (bad syntax, unknown route, wrong
 * method), security rejections handed over by ProblemSecurityHandlers, and
 * anything unexpected as a 500 that tells the client nothing about the cause.
 */
@RestControllerAdvice
public class ProblemAdvice extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ProblemAdvice.class);

    @ExceptionHandler(ApiProblem.class)
    ResponseEntity<Object> apiProblem(ApiProblem problem, HttpServletRequest request) {
        return respond(problem, new HttpHeaders(), request.getRequestURI());
    }

    /** Method level validation of a request body or a service argument. */
    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<Object> constraintViolation(ConstraintViolationException ex, HttpServletRequest request) {
        List<FieldError> errors = ex.getConstraintViolations().stream().map(ProblemAdvice::fieldError).toList();
        return respond(ApiProblem.validation(errors), new HttpHeaders(), request.getRequestURI());
    }

    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<Object> unauthenticated(AuthenticationException ex, HttpServletRequest request) {
        return respond(ApiProblem.of(ProblemTypes.UNAUTHENTICATED), new HttpHeaders(), request.getRequestURI());
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<Object> forbidden(AccessDeniedException ex, HttpServletRequest request) {
        return respond(ApiProblem.of(ProblemTypes.FORBIDDEN), new HttpHeaders(), request.getRequestURI());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> unexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled error on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return respond(ApiProblem.of(ProblemTypes.INTERNAL), new HttpHeaders(), request.getRequestURI());
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        List<FieldError> errors = ex.getBindingResult().getFieldErrors().stream()
            .map((error) -> new FieldError(pointer(error.getField()), code(error.getCode()),
                    error.getDefaultMessage()))
            .toList();
        return respond(ApiProblem.validation(errors), headers, path(request));
    }

    /** The one place Spring MVC's own exceptions pass through, with their status and headers. */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        if (status.is5xxServerError()) {
            log.error("Request failed with {}", status, ex);
        }
        return respond(ApiProblem.of(ProblemTypes.forStatus(status.value())), headers, path(request));
    }

    /**
     * The response for a problem a module mapped from its own errors, for example a
     * module's {@code @RestControllerAdvice} that turns domain errors into problems.
     */
    public static ResponseEntity<Object> respond(ApiProblem problem, HttpServletRequest request) {
        return respond(problem, new HttpHeaders(), request.getRequestURI());
    }

    private static ResponseEntity<Object> respond(ApiProblem problem, HttpHeaders headers, String instance) {
        HttpHeaders out = new HttpHeaders();
        out.putAll(headers);
        out.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        return new ResponseEntity<>(ProblemBody.of(problem, instance), out, problem.type().status());
    }

    private static FieldError fieldError(ConstraintViolation<?> violation) {
        String constraint = violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName();
        // The path starts with the method and parameter name; the field is what follows.
        String path = violation.getPropertyPath().toString();
        String[] parts = path.split("\\.", 3);
        return new FieldError(pointer(parts.length == 3 ? parts[2] : path), code(constraint), violation.getMessage());
    }

    /** {@code links.website} and {@code items[2].id} as JSON Pointers: /links/website, /items/2/id. */
    static String pointer(String field) {
        return "/" + field.replace("[", ".").replace("]", "").replace('.', '/');
    }

    /** A constraint name as a code: NotBlank to not_blank. */
    static String code(String constraint) {
        if (constraint == null || constraint.isEmpty()) {
            return "invalid";
        }
        return constraint.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase();
    }

    private static String path(WebRequest request) {
        return request instanceof ServletWebRequest servlet ? servlet.getRequest().getRequestURI() : null;
    }
}
