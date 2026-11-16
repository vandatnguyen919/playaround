package app.keylab.sound.uploads;

import java.time.Instant;
import java.util.UUID;

/**
 * One presigned upload (ADM-04): a ticket first, then the file, then one use.
 *
 * @param status pending (ticket only), received (file stored) or used (attached to a recording or switch)
 * @param sha256 of the received file, hex; null while pending
 */
public record Upload(
        UUID id,
        Purpose purpose,
        String contentType,
        String fileName,
        Status status,
        Long sizeBytes,
        String sha256,
        String createdBy,
        Instant createdAt,
        Instant expiresAt) {

    public enum Purpose {
        sound, switch_photo
    }

    public enum Status {
        pending, received, used
    }

    /** Where the received file sits until it is used. */
    public String blobKey() {
        return "uploads/" + id;
    }
}
