package app.keylab.catalog.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A switch as the catalog stores it. {@code version} is the row version, sent
 * as the ETag. Every switch starts as a draft; only publishing (ADM-03)
 * changes the status.
 */
public record Switch(
        UUID id,
        String slug,
        SwitchSpecs specs,
        Status status,
        String soundStatus,
        Instant newUntil,
        Instant publishedAt,
        long version,
        Instant updatedAt,
        String photoUrl) {

    public enum Status {
        draft, published, hidden
    }

    public boolean isDraft() {
        return status == Status.draft;
    }
}
