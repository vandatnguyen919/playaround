package app.keylab.sound.recordings;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import app.keylab.shared.Ids;
import app.keylab.shared.UserId;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.FieldError;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.sound.SoundProcessed;
import app.keylab.sound.SoundRemoved;
import app.keylab.sound.SwitchDirectory;
import app.keylab.sound.SwitchDirectory.SwitchRef;
import app.keylab.sound.uploads.Upload;
import app.keylab.sound.uploads.Uploads;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import tools.jackson.databind.JsonNode;

/**
 * Recordings for editors (US-38): attach a received upload to a switch slot
 * (ADM-04, answers 202 while processing runs), list and read them by status
 * or switch, and delete a bad take (ADM-05).
 */
@Service
public class Recordings {

    private final RecordingRepository recordings;
    private final Uploads uploads;
    private final SwitchDirectory switches;
    private final RecordingProcessor processor;
    private final ApplicationEventPublisher events;
    private final Clock clock = Clock.systemUTC();

    Recordings(RecordingRepository recordings, Uploads uploads, SwitchDirectory switches,
            RecordingProcessor processor, ApplicationEventPublisher events) {
        this.recordings = recordings;
        this.uploads = uploads;
        this.switches = switches;
        this.processor = processor;
        this.events = events;
    }

    /**
     * SoundAttach: {@code { uploadId, variant, stroke }}. The recording starts
     * as processing; processing starts once this transaction commits.
     *
     * @throws ApiProblem 404 switch_not_found, 422 validation_failed
     */
    @Transactional
    public SoundRecording attach(UUID switchId, JsonNode body, UserId editor) {
        if (switches.find(switchId).isEmpty()) {
            throw ApiProblem.of(ProblemTypes.NOT_FOUND, "switch_not_found", "No switch with this id");
        }
        List<FieldError> errors = new java.util.ArrayList<>();
        UUID uploadId = uuid(body, "uploadId", errors);
        SoundProcessed.Variant variant = choice(body, "variant", SoundProcessed.Variant.class,
                "Pick stock, lubed or foam.", errors);
        SoundProcessed.Stroke stroke = choice(body, "stroke", SoundProcessed.Stroke.class, "Pick press or release.",
                errors);
        if (!errors.isEmpty()) {
            throw ApiProblem.validation(errors);
        }
        Upload upload = uploads.useSound(uploadId);
        UUID id = Ids.uuidV7();
        recordings.insert(id, switchId, variant, stroke, upload.id(), upload.fileName(), editor.toString(),
                clock.instant());
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                processor.submit(id);
            }
        });
        return recordings.find(id).orElseThrow();
    }

    /** @throws ApiProblem 404 sound_not_found */
    public SoundRecording get(UUID id) {
        return recordings.find(id).orElseThrow(Recordings::notFound);
    }

    public PageResult<SoundRecording> list(SoundRecording.Status status, UUID switchId, PageQuery page) {
        return PageResult.of(recordings.list(status == null ? null : status.name(), switchId, page), page,
                RecordingRepository::cursorOf);
    }

    /**
     * Deletes a take. When it was the one that plays, catalog hears of it
     * (SoundRemoved) and moves the slot back to the newest ready take left.
     *
     * @throws ApiProblem 404 sound_not_found, 409 sound_in_use (the last stock take of a published switch)
     */
    @Transactional
    public void delete(UUID id) {
        SoundRecording recording = recordings.lock(id).orElseThrow(Recordings::notFound);
        if (recording.status() == SoundRecording.Status.ready) {
            SoundRecording replacement = recordings
                .newestReady(recording.switchId(), recording.variant(), recording.stroke(), recording.id())
                .orElse(null);
            boolean published = switches.find(recording.switchId()).map(SwitchRef::published).orElse(false);
            if (replacement == null && published && recording.variant() == SoundProcessed.Variant.stock) {
                throw ApiProblem.of(ProblemTypes.CONFLICT, "sound_in_use",
                        "This is the only stock " + recording.stroke() + " of a published switch. "
                                + "Upload a new take first, or pull the switch from the library.");
            }
            events.publishEvent(new SoundRemoved(recording.id(), recording.switchId(), recording.variant(),
                    recording.stroke(), replacement == null ? null : replacement.toEvent()));
        }
        recordings.delete(id);
    }

    private static ApiProblem notFound() {
        return ApiProblem.of(ProblemTypes.NOT_FOUND, "sound_not_found", "No recording with this id");
    }

    private static UUID uuid(JsonNode body, String field, List<FieldError> errors) {
        JsonNode node = body == null ? null : body.get(field);
        if (node == null || node.isNull()) {
            errors.add(new FieldError("/" + field, "required", "Upload the file first."));
            return null;
        }
        try {
            return UUID.fromString(node.asString());
        }
        catch (RuntimeException ex) {
            errors.add(new FieldError("/" + field, "upload_not_found", "No upload with this id."));
            return null;
        }
    }

    private static <E extends Enum<E>> E choice(JsonNode body, String field, Class<E> type, String message,
            List<FieldError> errors) {
        JsonNode node = body == null ? null : body.get(field);
        if (node != null && node.isString()) {
            for (E value : type.getEnumConstants()) {
                if (value.name().equals(node.asString())) {
                    return value;
                }
            }
        }
        errors.add(new FieldError("/" + field, node == null || node.isNull() ? "required" : "invalid_choice",
                message));
        return null;
    }
}
