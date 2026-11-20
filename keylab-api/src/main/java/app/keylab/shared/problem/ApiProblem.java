package app.keylab.shared.problem;

import java.util.List;

/**
 * Thrown by any module to answer with problem+json. ProblemAdvice writes it.
 *
 * <pre>
 * throw ApiProblem.of(ProblemTypes.CONFLICT, "missing_required_sounds", "Record the stock sounds first");
 * throw ApiProblem.validation(List.of(new FieldError("/username", "username_taken", "@clack is taken.")));
 * </pre>
 */
public class ApiProblem extends RuntimeException {

    private final ProblemTypes type;
    private final String code;
    private final String title;
    private final String detail;
    private final List<FieldError> errors;

    private ApiProblem(ProblemTypes type, String code, String title, String detail, List<FieldError> errors) {
        super(code + ": " + title);
        this.type = type;
        this.code = code;
        this.title = title;
        this.detail = detail;
        this.errors = List.copyOf(errors);
    }

    /** The type's default code and title. */
    public static ApiProblem of(ProblemTypes type) {
        return new ApiProblem(type, type.code(), type.title(), null, List.of());
    }

    /** A specific, stable code with a title for the person. */
    public static ApiProblem of(ProblemTypes type, String code, String title) {
        return new ApiProblem(type, code, title, null, List.of());
    }

    public static ApiProblem of(ProblemTypes type, String code, String title, String detail) {
        return new ApiProblem(type, code, title, detail, List.of());
    }

    /** 422 with one entry per invalid field. */
    public static ApiProblem validation(List<FieldError> errors) {
        return new ApiProblem(ProblemTypes.VALIDATION, ProblemTypes.VALIDATION.code(),
                ProblemTypes.VALIDATION.title(), null, errors);
    }

    /** 422 with its own stable code (such as {@code part_not_found}) and one entry per bad field. */
    public static ApiProblem validation(String code, String title, List<FieldError> errors) {
        return new ApiProblem(ProblemTypes.VALIDATION, code, title, null, errors);
    }

    public ProblemTypes type() {
        return type;
    }

    public String code() {
        return code;
    }

    public String title() {
        return title;
    }

    public String detail() {
        return detail;
    }

    public List<FieldError> errors() {
        return errors;
    }
}
