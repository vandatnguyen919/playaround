package app.keylab.sound.recordings;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import app.keylab.sound.SoundProcessed;

/**
 * One take of one stroke of one variant, as the sound module keeps it.
 *
 * @param status processing, ready or failed
 * @param url content-addressed URL; set once ready
 * @param error why it failed, for the editor; set once failed
 */
public record SoundRecording(
        UUID id,
        UUID switchId,
        SoundProcessed.Variant variant,
        SoundProcessed.Stroke stroke,
        UUID uploadId,
        String fileName,
        Status status,
        String url,
        Integer durationMs,
        BigDecimal loudnessLufs,
        List<Double> peaks,
        String error,
        Instant createdAt,
        Instant processedAt) {

    public enum Status {
        processing, ready, failed
    }

    /** The event catalog listens to, for a recording that finished processing. */
    public SoundProcessed toEvent() {
        return new SoundProcessed(id, switchId, variant, stroke,
                status == Status.ready ? SoundProcessed.Outcome.ready : SoundProcessed.Outcome.failed, url,
                durationMs, loudnessLufs, peaks, processedAt);
    }
}
