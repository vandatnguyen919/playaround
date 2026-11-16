package app.keylab.catalog.adapter.in.events;

import app.keylab.catalog.application.RecordSwitchSound;
import app.keylab.catalog.domain.ReadyRecording;
import app.keylab.sound.SoundProcessed;
import app.keylab.sound.SoundRemoved;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;

/**
 * The sound module's events, handed to {@link RecordSwitchSound} (US-39).
 * Runs after the sound module's transaction commits, in its own; the event
 * publication registry retries it if it fails.
 */
@Component
class SoundStatusListener {

    private static final Logger log = LoggerFactory.getLogger(SoundStatusListener.class);

    private final RecordSwitchSound sounds;

    SoundStatusListener(RecordSwitchSound sounds) {
        this.sounds = sounds;
    }

    @ApplicationModuleListener
    void on(SoundProcessed event) {
        if (event.outcome() != SoundProcessed.Outcome.ready) {
            // A failed upload leaves the last ready recording in place; the editor sees why in the sound library.
            log.info("Recording {} for switch {} failed processing; keeping what catalog has", event.recordingId(),
                    event.switchId());
            return;
        }
        sounds.ready(ready(event));
    }

    @ApplicationModuleListener
    void on(SoundRemoved event) {
        SoundProcessed replacement = event.replacement();
        boolean ready = replacement != null && replacement.outcome() == SoundProcessed.Outcome.ready;
        sounds.removed(event.switchId(), event.recordingId(), ready ? ready(replacement) : null);
    }

    private static ReadyRecording ready(SoundProcessed event) {
        return new ReadyRecording(event.switchId(), event.variant().name(), event.stroke().name(),
                event.recordingId(), event.url(), event.durationMs(), event.loudnessLufs(), event.peaks(),
                event.processedAt());
    }
}
