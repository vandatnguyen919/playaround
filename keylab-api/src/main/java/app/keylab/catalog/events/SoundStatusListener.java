package app.keylab.catalog.events;

import app.keylab.catalog.persistence.LibraryRepository;
import app.keylab.sound.SoundProcessed;
import app.keylab.sound.SoundRemoved;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;

/**
 * Keeps catalog's copy of a switch's ready recordings and its sound status
 * in step with the sound module (US-39). Runs after the sound module's
 * transaction commits, in its own; the event publication registry retries it
 * if it fails.
 */
@Component
class SoundStatusListener {

    private static final Logger log = LoggerFactory.getLogger(SoundStatusListener.class);

    private final LibraryRepository library;

    SoundStatusListener(LibraryRepository library) {
        this.library = library;
    }

    @ApplicationModuleListener
    void on(SoundProcessed event) {
        if (event.outcome() != SoundProcessed.Outcome.ready) {
            // A failed upload leaves the last ready recording in place; the editor sees why in the sound library.
            log.info("Recording {} for switch {} failed processing; keeping what catalog has", event.recordingId(),
                    event.switchId());
            return;
        }
        if (!library.lockSwitch(event.switchId())) {
            log.info("Recording {} is for switch {}, which is gone; nothing to keep", event.recordingId(),
                    event.switchId());
            return;
        }
        library.saveReady(event.switchId(), event.variant().name(), event.stroke().name(), event.recordingId(),
                event.url(), event.durationMs(), event.loudnessLufs(), event.peaks(), event.processedAt());
        library.refreshSoundStatus(event.switchId());
    }

    /**
     * A ready take was deleted (ADM-05): drop it if it is the one catalog
     * plays, and move the slot to the replacement the sound module names.
     */
    @ApplicationModuleListener
    void on(SoundRemoved event) {
        if (!library.lockSwitch(event.switchId())) {
            return;
        }
        library.removeRecording(event.recordingId());
        SoundProcessed replacement = event.replacement();
        if (replacement != null && replacement.outcome() == SoundProcessed.Outcome.ready) {
            library.saveReady(replacement.switchId(), replacement.variant().name(), replacement.stroke().name(),
                    replacement.recordingId(), replacement.url(), replacement.durationMs(),
                    replacement.loudnessLufs(), replacement.peaks(), replacement.processedAt());
        }
        library.refreshSoundStatus(event.switchId());
    }
}
