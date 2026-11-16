package app.keylab.catalog.domain;

import java.util.UUID;

/** Outbound port: the switch photo comes from an upload, which the sound module owns (US-38). */
public interface SwitchPhotos {

    /**
     * Takes a received {@code switch_photo} upload: a square PNG or JPG of at
     * least 800 px. The upload's own checks answer for themselves.
     *
     * @param pointer the JSON Pointer of the field that named the upload, for the error
     * @return the photo's public URL
     */
    String use(UUID uploadId, String pointer);
}
