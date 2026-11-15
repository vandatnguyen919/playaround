package app.keylab.sound;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A recording finished processing (ADM-05, US-38): it is either ready to play
 * or failed. Published by {@code sound}; {@code catalog} keeps its own copy of
 * the ready recordings and allows publishing once the stock press and release
 * are both ready (US-39).
 *
 * <p>Events can arrive late or twice: listeners keep the one with the latest
 * {@code processedAt} per switch, variant and stroke.
 *
 * @param recordingId the recording
 * @param switchId the catalog switch it belongs to (by id only, no shared types)
 * @param variant stock, lubed or foam
 * @param stroke press or release
 * @param outcome ready or failed
 * @param url content-addressed CDN URL; null when failed
 * @param durationMs length; null when failed
 * @param loudnessLufs integrated loudness; null when failed
 * @param peaks waveform peaks from 0 to 1, drawn without decoding the audio; empty when failed
 * @param processedAt when processing ended
 */
public record SoundProcessed(
        UUID recordingId,
        UUID switchId,
        Variant variant,
        Stroke stroke,
        Outcome outcome,
        String url,
        Integer durationMs,
        BigDecimal loudnessLufs,
        List<Double> peaks,
        Instant processedAt) {

    public enum Variant {
        stock, lubed, foam
    }

    public enum Stroke {
        press, release
    }

    public enum Outcome {
        ready, failed
    }

    public SoundProcessed {
        peaks = peaks == null ? List.of() : List.copyOf(peaks);
    }
}
