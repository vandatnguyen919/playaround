package app.keylab.sound;

import java.util.UUID;

import app.keylab.shared.problem.ApiProblem;

/**
 * The direct calls other modules may make into sound. Uploads live here
 * (modulith-plan.md: sound owns uploads), and a switch photo arrives through
 * one too (ADM-02 {@code photoUploadId}, US-38).
 */
public interface SoundApi {

    /**
     * Takes a received {@code switch_photo} upload, checks it is a square PNG
     * or JPG of at least 800 px, stores it content-addressed and marks the
     * upload used.
     *
     * @param pointer the JSON pointer of the field that named the upload, for the 422
     * @return the photo's public URL
     * @throws ApiProblem 422 validation_failed with one error at {@code pointer}
     */
    String usePhoto(UUID uploadId, String pointer);
}
