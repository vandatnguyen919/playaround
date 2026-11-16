package app.keylab.sound;

import java.util.UUID;

/**
 * A ready recording was deleted (ADM-05, US-38). Listeners drop their copy
 * of it. When an older ready take of the same slot remains, it comes along as
 * {@code replacement}, so the slot moves back to it in one step.
 *
 * @param recordingId the deleted recording
 * @param switchId its switch
 * @param variant stock, lubed or foam
 * @param stroke press or release
 * @param replacement the newest ready take left for the slot, or null when none is left
 */
public record SoundRemoved(
        UUID recordingId,
        UUID switchId,
        SoundProcessed.Variant variant,
        SoundProcessed.Stroke stroke,
        SoundProcessed replacement) {
}
