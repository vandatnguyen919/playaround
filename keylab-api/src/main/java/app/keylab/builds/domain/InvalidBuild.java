package app.keylab.builds.domain;

import java.util.List;

/** A build that breaks a rule: its name, its visibility, or a part. One violation per field. */
public final class InvalidBuild extends BuildsException {

    private final List<Violation> violations;

    public InvalidBuild(List<Violation> violations) {
        super("Invalid build: " + violations);
        this.violations = List.copyOf(violations);
    }

    public List<Violation> violations() {
        return violations;
    }
}
