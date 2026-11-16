package app.keylab.catalog.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * A switch in the catalog, the aggregate behind ADM-02 and ADM-03 (US-37,
 * US-39). It holds the rules of its life: every switch starts as a draft; a
 * draft's slug follows its name while a published one keeps its link; only
 * drafts can be deleted; publishing needs the stock press and release
 * recorded and sets or clears the New sticker; pulling it hides it and clears
 * the sticker. Each change is recorded as a {@link SwitchEvent} for
 * {@link Switches#save} to write and publish.
 *
 * <p>{@code version} is the row version this state was loaded at, sent as the
 * ETag; a save checks it.
 */
public final class Switch {

    /** How long the New sticker shows. App settings (ADM-11) may make this editable later. */
    public static final Duration NEW_FOR = Duration.ofDays(30);

    private final UUID id;
    private String slug;
    private SwitchSpecs specs;
    private Status status;
    private final SoundStatus soundStatus;
    private Instant newUntil;
    private Instant publishedAt;
    private final long version;
    private Instant updatedAt;
    private String updatedBy;
    private String photoUrl;
    private final List<SwitchEvent> events = new ArrayList<>();

    private Switch(UUID id, String slug, SwitchSpecs specs, Status status, SoundStatus soundStatus, Instant newUntil,
            Instant publishedAt, long version, Instant updatedAt, String updatedBy, String photoUrl) {
        this.id = id;
        this.slug = slug;
        this.specs = specs;
        this.status = status;
        this.soundStatus = soundStatus;
        this.newUntil = newUntil;
        this.publishedAt = publishedAt;
        this.version = version;
        this.updatedAt = updatedAt;
        this.updatedBy = updatedBy;
        this.photoUrl = photoUrl;
    }

    /**
     * A new draft with no sounds yet. Not stored until {@link Switches#add}.
     *
     * @param slugTaken whether another switch has this slug
     * @throws InvalidSwitchSpecs when the specs break a rule
     */
    public static Switch create(UUID id, SwitchSpecs specs, Predicate<String> slugTaken, String editor, Instant now) {
        specs.verify();
        return new Switch(id, Slug.firstFree(specs.name(), slugTaken, null), specs, Status.DRAFT,
                SoundStatus.MISSING, null, null, 0, now, editor, null);
    }

    /** A switch as it was stored, for the persistence adapter. */
    public static Switch restore(UUID id, String slug, SwitchSpecs specs, Status status, SoundStatus soundStatus,
            Instant newUntil, Instant publishedAt, long version, Instant updatedAt, String updatedBy,
            String photoUrl) {
        return new Switch(id, slug, specs, status, soundStatus, newUntil, publishedAt, version, updatedAt, updatedBy,
                photoUrl);
    }

    /**
     * New specs from an editor. A draft's slug follows its name, so it moves
     * when the name does; once published, links to it must keep working.
     *
     * @throws InvalidSwitchSpecs when the specs break a rule
     */
    public void edit(SwitchSpecs specs, Predicate<String> slugTaken, String editor, Instant now) {
        specs.verify();
        boolean renamed = !Slug.base(specs.name()).equals(Slug.base(this.specs.name()));
        if (isDraft() && renamed) {
            slug = Slug.firstFree(specs.name(), slugTaken, slug);
        }
        this.specs = specs;
        touch(editor, now);
        events.add(new SwitchEvent.Edited(id, slug, now));
    }

    /** Sets or clears the photo (US-38); it rides on the save of the edit or create that names it. */
    public void changePhoto(String url) {
        this.photoUrl = url;
    }

    /**
     * Puts the switch in the public library. Publishing again is allowed:
     * the first publish date stays, and the New sticker is set for
     * {@link #NEW_FOR} or cleared, as asked.
     *
     * @throws MissingRequiredSounds unless the stock press and release are recorded
     */
    public void publish(boolean markNew, Instant now, String editor) {
        if (soundStatus != SoundStatus.RECORDED) {
            throw new MissingRequiredSounds();
        }
        status = Status.PUBLISHED;
        if (publishedAt == null) {
            publishedAt = now;
        }
        newUntil = markNew ? now.plus(NEW_FOR) : null;
        touch(editor, now);
        events.add(new SwitchEvent.Published(id, slug, publishedAt, newUntil));
    }

    /**
     * Takes a published switch out of the library; it stays for the builds
     * that use it. A draft or an already pulled switch is left as it is.
     */
    public void unpublish(Instant now, String editor) {
        if (status != Status.PUBLISHED) {
            return;
        }
        status = Status.HIDDEN;
        newUntil = null;
        touch(editor, now);
        events.add(new SwitchEvent.Unpublished(id, now));
    }

    /**
     * Checks the switch may go for good: only drafts can, since a published
     * switch may be in someone's build. {@link Switches#remove} deletes it.
     *
     * @throws SwitchNotDraft for a published or pulled switch
     */
    public void delete() {
        if (!isDraft()) {
            throw new SwitchNotDraft();
        }
    }

    public boolean isDraft() {
        return status == Status.DRAFT;
    }

    public boolean isPublished() {
        return status == Status.PUBLISHED;
    }

    /** Whether the New sticker shows at {@code now}. */
    public boolean isNew(Instant now) {
        return newUntil != null && newUntil.isAfter(now);
    }

    /** The changes since it was loaded or created, oldest first. */
    public List<SwitchEvent> events() {
        return List.copyOf(events);
    }

    /** Called once the changes are stored. */
    public void clearEvents() {
        events.clear();
    }

    private void touch(String editor, Instant now) {
        this.updatedBy = editor;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public String slug() {
        return slug;
    }

    public SwitchSpecs specs() {
        return specs;
    }

    public Status status() {
        return status;
    }

    public SoundStatus soundStatus() {
        return soundStatus;
    }

    public Instant newUntil() {
        return newUntil;
    }

    public Instant publishedAt() {
        return publishedAt;
    }

    public long version() {
        return version;
    }

    public Instant updatedAt() {
        return updatedAt;
    }

    public String updatedBy() {
        return updatedBy;
    }

    public String photoUrl() {
        return photoUrl;
    }
}
