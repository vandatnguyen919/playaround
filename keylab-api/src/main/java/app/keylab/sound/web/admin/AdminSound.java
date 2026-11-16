package app.keylab.sound.web.admin;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import app.keylab.sound.recordings.SoundRecording;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * AdminSound in openapi-v1.yaml: a Recording plus its status. {@code url},
 * {@code durationMs}, {@code loudnessLufs} and {@code peaks} come once ready,
 * {@code error} once failed. The switch is named by {@code switchId}; the
 * admin pages take names from ADM-02, which catalog owns.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record AdminSound(UUID id, UUID switchId, String variant, String stroke, String status, String fileName, String url,
        Integer durationMs, BigDecimal loudnessLufs, List<Double> peaks, String error, Instant createdAt,
        Instant processedAt) {

    static AdminSound of(SoundRecording r) {
        boolean ready = r.status() == SoundRecording.Status.ready;
        return new AdminSound(r.id(), r.switchId(), r.variant().name(), r.stroke().name(), r.status().name(),
                r.fileName(), r.url(), r.durationMs(), r.loudnessLufs(), ready ? r.peaks() : null, r.error(),
                r.createdAt(), r.processedAt());
    }
}
