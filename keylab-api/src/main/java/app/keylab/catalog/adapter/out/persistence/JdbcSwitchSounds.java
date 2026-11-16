package app.keylab.catalog.adapter.out.persistence;

import java.sql.Timestamp;
import java.util.UUID;

import app.keylab.catalog.domain.ReadyRecording;
import app.keylab.catalog.domain.SwitchSounds;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.json.JsonMapper;

/** {@link SwitchSounds} in {@code catalog.switch_recordings} and {@code catalog.switches.sound_status}. */
@Repository
class JdbcSwitchSounds implements SwitchSounds {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcSwitchSounds(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public boolean lock(UUID switchId) {
        return jdbc.sql("SELECT id FROM catalog.switches WHERE id = ? FOR UPDATE").param(switchId)
            .query(UUID.class).optional().isPresent();
    }

    @Override
    public void keep(ReadyRecording r) {
        jdbc.sql("""
                INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms,
                  loudness_lufs, peaks, processed_at)
                SELECT :switchId, :variant, :stroke, :recordingId, :url, :durationMs, :loudness,
                  CAST(:peaks AS jsonb), :processedAt
                WHERE EXISTS (SELECT 1 FROM catalog.switches WHERE id = :switchId)
                ON CONFLICT (switch_id, variant, stroke) DO UPDATE SET recording_id = excluded.recording_id,
                  url = excluded.url, duration_ms = excluded.duration_ms, loudness_lufs = excluded.loudness_lufs,
                  peaks = excluded.peaks, processed_at = excluded.processed_at
                WHERE switch_recordings.processed_at <= excluded.processed_at
                """)
            .param("switchId", r.switchId())
            .param("variant", r.variant())
            .param("stroke", r.stroke())
            .param("recordingId", r.recordingId())
            .param("url", r.url())
            .param("durationMs", r.durationMs())
            .param("loudness", r.loudnessLufs())
            .param("peaks", json.writeValueAsString(r.peaks()))
            .param("processedAt", Timestamp.from(r.processedAt()))
            .update();
    }

    @Override
    public void forget(UUID recordingId) {
        jdbc.sql("DELETE FROM catalog.switch_recordings WHERE recording_id = ?").param(recordingId).update();
    }

    @Override
    public void refreshSoundStatus(UUID switchId) {
        jdbc.sql("""
                UPDATE catalog.switches SET sound_status = CASE WHEN (
                  SELECT count(*) FROM catalog.switch_recordings
                  WHERE switch_id = :id AND variant = 'stock') = 2 THEN 'recorded' ELSE 'missing' END
                WHERE id = :id
                """)
            .param("id", switchId)
            .update();
    }
}
