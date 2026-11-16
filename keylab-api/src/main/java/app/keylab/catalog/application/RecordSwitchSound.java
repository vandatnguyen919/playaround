package app.keylab.catalog.application;

import java.util.UUID;

import app.keylab.catalog.domain.ReadyRecording;
import app.keylab.catalog.domain.SwitchSounds;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Keeps catalog's copy of a switch's ready recordings, and so its sound
 * status, in step with the sound module (US-39). Runs in the transaction of
 * the event listener that calls it.
 */
@PrimaryPort
@Service
public class RecordSwitchSound {

    private static final Logger log = LoggerFactory.getLogger(RecordSwitchSound.class);

    private final SwitchSounds sounds;

    RecordSwitchSound(SwitchSounds sounds) {
        this.sounds = sounds;
    }

    /** A recording is ready: it becomes the one the library plays for its slot. */
    @Transactional
    public void ready(ReadyRecording recording) {
        if (!sounds.lock(recording.switchId())) {
            log.info("Recording {} is for switch {}, which is gone; nothing to keep", recording.recordingId(),
                    recording.switchId());
            return;
        }
        sounds.keep(recording);
        sounds.refreshSoundStatus(recording.switchId());
    }

    /**
     * A ready take was deleted (ADM-05): drop it if it is the one catalog
     * plays, and move the slot to the replacement the sound module names.
     *
     * @param replacement the newest ready take left for the slot, or null
     */
    @Transactional
    public void removed(UUID switchId, UUID recordingId, ReadyRecording replacement) {
        if (!sounds.lock(switchId)) {
            return;
        }
        sounds.forget(recordingId);
        if (replacement != null) {
            sounds.keep(replacement);
        }
        sounds.refreshSoundStatus(switchId);
    }
}
