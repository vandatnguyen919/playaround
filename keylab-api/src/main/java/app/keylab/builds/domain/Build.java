package app.keylab.builds.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A member's saved build, the aggregate behind BLD-02 and BLD-04 (US-08).
 * Its rules: only its owner changes it (anyone else gets
 * {@link BuildNotFound}); a new build starts private unless asked public and
 * starts at version 1; new parts add version n + 1 and make it the current
 * one, while a rename or a visibility change writes no version; the name is
 * 1 to {@value #NAME_MAX} characters after trimming. Each change is recorded
 * as a {@link BuildEvent} for {@link Builds#save} to write.
 *
 * <p>{@code version} is the row version this state was loaded at, sent as the
 * ETag; a save checks it.
 */
public final class Build {

    public static final int NAME_MAX = 60;

    private final UUID id;
    private final UUID ownerId;
    private String name;
    private Visibility visibility;
    private BuildVersion current;
    private final long version;
    private final Instant createdAt;
    private Instant updatedAt;
    private final List<BuildEvent> events = new ArrayList<>();

    private Build(UUID id, UUID ownerId, String name, Visibility visibility, BuildVersion current, long version,
            Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.ownerId = ownerId;
        this.name = name;
        this.visibility = visibility;
        this.current = current;
        this.version = version;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    /**
     * A new build at version 1. Not stored until {@link Builds#add}.
     *
     * @throws InvalidBuild when the name breaks a rule
     */
    public static Build create(UUID id, UUID ownerId, String name, Visibility visibility, Parts parts,
            KeycapLook keycaps, Sound sound, Instant now) {
        String checked = checkedName(name);
        return new Build(id, ownerId, checked, visibility == null ? Visibility.PRIVATE : visibility,
                new BuildVersion(1, parts, keycaps, sound), 1, now, now);
    }

    /** A build as it was stored, for the persistence adapter. */
    public static Build restore(UUID id, UUID ownerId, String name, Visibility visibility, BuildVersion current,
            long version, Instant createdAt, Instant updatedAt) {
        return new Build(id, ownerId, name, visibility, current, version, createdAt, updatedAt);
    }

    /** The name, trimmed, or what is wrong with it. */
    public static List<Violation> nameViolations(String name) {
        String trimmed = name == null ? "" : name.strip();
        if (trimmed.isEmpty()) {
            return List.of(new Violation("/name", "required", "Give the build a name."));
        }
        if (trimmed.codePointCount(0, trimmed.length()) > NAME_MAX) {
            return List.of(new Violation("/name", "too_long", "Keep the name to " + NAME_MAX + " characters."));
        }
        return List.of();
    }

    private static String checkedName(String name) {
        List<Violation> violations = nameViolations(name);
        if (!violations.isEmpty()) {
            throw new InvalidBuild(violations);
        }
        return name.strip();
    }

    public boolean isOwnedBy(UUID caller) {
        return ownerId.equals(caller);
    }

    /** @throws InvalidBuild when the name breaks a rule */
    public void rename(String newName, Instant now) {
        String checked = checkedName(newName);
        if (checked.equals(name)) {
            return;
        }
        name = checked;
        updatedAt = now;
        events.add(new BuildEvent.Renamed(checked));
    }

    public void changeVisibility(Visibility newVisibility, Instant now) {
        if (newVisibility == null || newVisibility == visibility) {
            return;
        }
        visibility = newVisibility;
        updatedAt = now;
        events.add(new BuildEvent.VisibilityChanged(newVisibility));
    }

    /** New parts become version n + 1; the same parts again change nothing. */
    public void changeParts(Parts parts, KeycapLook keycaps, Sound sound, Instant now) {
        if (parts.equals(current.parts())) {
            return;
        }
        current = new BuildVersion(current.number() + 1, parts, keycaps, sound);
        updatedAt = now;
        events.add(new BuildEvent.Saved(current));
    }

    public UUID id() {
        return id;
    }

    public UUID ownerId() {
        return ownerId;
    }

    public String name() {
        return name;
    }

    public Visibility visibility() {
        return visibility;
    }

    public BuildVersion current() {
        return current;
    }

    public long version() {
        return version;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant updatedAt() {
        return updatedAt;
    }

    public List<BuildEvent> events() {
        return List.copyOf(events);
    }
}
