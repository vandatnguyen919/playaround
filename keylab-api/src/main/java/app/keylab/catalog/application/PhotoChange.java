package app.keylab.catalog.application;

import java.util.UUID;

/**
 * What a create or edit says about the photo ({@code photoUploadId}): left
 * out keeps it, null clears it, an id takes that upload (US-38).
 */
public record PhotoChange(boolean changes, UUID uploadId) {

    public static final PhotoChange KEEP = new PhotoChange(false, null);
    public static final PhotoChange CLEAR = new PhotoChange(true, null);

    public static PhotoChange use(UUID uploadId) {
        return new PhotoChange(true, uploadId);
    }
}
