package app.keylab.catalog.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * What happened to a switch, recorded by the aggregate and published when it
 * is saved. No module listens yet; {@code sound} will want
 * {@link Published} when it keeps its own copy of catalog data
 * (modulith-plan.md, Module map).
 */
public sealed interface SwitchEvent {

    UUID switchId();

    /** An editor changed the specs (and maybe the photo or slug). */
    record Edited(UUID switchId, String slug, Instant at) implements SwitchEvent {
    }

    /** The switch is in the public library, showing the New sticker until {@code newUntil} (or not, when null). */
    record Published(UUID switchId, String slug, Instant publishedAt, Instant newUntil) implements SwitchEvent {
    }

    /** The switch left the public library; it stays for the builds that use it. */
    record Unpublished(UUID switchId, Instant at) implements SwitchEvent {
    }
}
