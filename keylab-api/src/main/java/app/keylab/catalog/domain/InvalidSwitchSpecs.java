package app.keylab.catalog.domain;

import java.util.List;

/** The specs break one or more rules; every one is listed, so one answer names each field to fix. */
public final class InvalidSwitchSpecs extends CatalogException {

    private final List<Violation> violations;

    public InvalidSwitchSpecs(List<Violation> violations) {
        super("Some fields need a fix: " + violations.size());
        this.violations = List.copyOf(violations);
    }

    public List<Violation> violations() {
        return violations;
    }
}
