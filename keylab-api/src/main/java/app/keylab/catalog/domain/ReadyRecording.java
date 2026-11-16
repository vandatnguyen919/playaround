package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A recording the sound module finished, as catalog keeps it for the library
 * to play (US-39). One slot per switch, variant and stroke; the latest
 * {@code processedAt} wins.
 *
 * @param variant stock, lubed or foam
 * @param stroke press or release
 */
public record ReadyRecording(UUID switchId, String variant, String stroke, UUID recordingId, String url,
        Integer durationMs, BigDecimal loudnessLufs, List<Double> peaks, Instant processedAt) {
}
