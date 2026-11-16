package app.keylab.catalog.domain;

import java.util.ArrayList;
import java.util.List;

/** Collects every {@link Violation} of one set of specs, in the order the fields are checked. */
public final class Violations {

    private final List<Violation> list = new ArrayList<>();

    public void add(String pointer, String code, String message) {
        list.add(new Violation(pointer, code, message));
    }

    public int size() {
        return list.size();
    }

    public boolean isEmpty() {
        return list.isEmpty();
    }

    /** @throws InvalidSwitchSpecs listing every violation, if there is any */
    public void throwIfAny() {
        if (!list.isEmpty()) {
            throw new InvalidSwitchSpecs(list);
        }
    }
}
