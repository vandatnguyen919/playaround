package app.keylab.shared.problem;

import org.springframework.http.HttpStatus;

/**
 * The RFC 9457 problem types every module answers with. The type says what
 * kind of error it is; the {@code code} on the problem says exactly which one
 * (api-design-v1.md, Conventions, Errors).
 */
public enum ProblemTypes {

    BAD_REQUEST("bad-request", HttpStatus.BAD_REQUEST, "The request could not be read", "bad_request"),
    UNAUTHENTICATED("unauthenticated", HttpStatus.UNAUTHORIZED, "Sign in to continue", "unauthenticated"),
    FORBIDDEN("forbidden", HttpStatus.FORBIDDEN, "You do not have access to this", "forbidden"),
    NOT_FOUND("not-found", HttpStatus.NOT_FOUND, "Nothing here", "not_found"),
    METHOD_NOT_ALLOWED("method-not-allowed", HttpStatus.METHOD_NOT_ALLOWED, "Method not allowed",
            "method_not_allowed"),
    NOT_ACCEPTABLE("not-acceptable", HttpStatus.NOT_ACCEPTABLE, "Cannot answer in that format", "not_acceptable"),
    CONFLICT("conflict", HttpStatus.CONFLICT, "That does not fit the current state", "conflict"),
    GONE("gone", HttpStatus.GONE, "This API version has been retired", "version_sunset"),
    PRECONDITION_FAILED("precondition-failed", HttpStatus.PRECONDITION_FAILED,
            "This changed since you loaded it", "precondition_failed"),
    UNSUPPORTED_MEDIA_TYPE("unsupported-media-type", HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            "Unsupported content type", "unsupported_media_type"),
    VALIDATION("validation", HttpStatus.UNPROCESSABLE_CONTENT, "Some fields need a fix", "validation_failed"),
    RATE_LIMITED("rate-limited", HttpStatus.TOO_MANY_REQUESTS, "Too many requests", "rate_limited"),
    INTERNAL("internal", HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong on our side", "internal_error");

    private static final String BASE = "https://keylab.app/problems/";

    private final String slug;
    private final HttpStatus status;
    private final String title;
    private final String code;

    ProblemTypes(String slug, HttpStatus status, String title, String code) {
        this.slug = slug;
        this.status = status;
        this.title = title;
        this.code = code;
    }

    public String uri() {
        return BASE + slug;
    }

    public HttpStatus status() {
        return status;
    }

    /** Default title, when a problem does not bring its own. */
    public String title() {
        return title;
    }

    /** Default code, when a problem does not bring its own. */
    public String code() {
        return code;
    }

    /** The type for a status code raised by the framework, not by KeyLab code. */
    public static ProblemTypes forStatus(int status) {
        for (ProblemTypes type : values()) {
            if (type.status.value() == status) {
                return type;
            }
        }
        return status >= 500 ? INTERNAL : BAD_REQUEST;
    }
}
