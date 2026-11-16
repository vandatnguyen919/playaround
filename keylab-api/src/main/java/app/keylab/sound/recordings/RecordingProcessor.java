package app.keylab.sound.recordings;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.keylab.sound.processing.WavAnalysis;
import app.keylab.sound.processing.WavAnalysis.Refused;
import app.keylab.sound.processing.WavAnalysis.Result;
import app.keylab.sound.storage.BlobStore;
import app.keylab.sound.uploads.Uploads;

import jakarta.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Processes recordings off the request thread (the attach answers 202): checks
 * the WAV, measures it, stores it content-addressed and moves the recording to
 * ready or failed. Either way it publishes {@code SoundProcessed} in the same
 * transaction, through the event publication registry, so catalog never
 * misses one. Recordings still processing at start (a restart mid-way) are
 * picked up again.
 */
@Component
class RecordingProcessor {

    private static final Logger log = LoggerFactory.getLogger(RecordingProcessor.class);

    private final RecordingRepository recordings;
    private final Uploads files;
    private final BlobStore blobs;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;
    private final String publicBase;
    private final ExecutorService executor = Executors.newFixedThreadPool(2, Thread.ofPlatform()
        .name("sound-processing-", 1).daemon(true).factory());
    private final Clock clock = Clock.systemUTC();

    RecordingProcessor(RecordingRepository recordings, Uploads files, BlobStore blobs, TransactionTemplate tx,
            ApplicationEventPublisher events, @Value("${keylab.storage.public-base}") String publicBase) {
        this.recordings = recordings;
        this.files = files;
        this.blobs = blobs;
        this.tx = tx;
        this.events = events;
        this.publicBase = publicBase.replaceAll("/+$", "");
    }

    void submit(UUID recordingId) {
        executor.execute(() -> {
            try {
                process(recordingId);
            }
            catch (RuntimeException ex) {
                log.error("Processing recording {} failed unexpectedly", recordingId, ex);
                finish(recordingId, null, null, "Processing failed on our side. Delete this take and upload again.");
            }
        });
    }

    @EventListener(ApplicationReadyEvent.class)
    void resumeUnfinished() {
        recordings.processing().forEach(this::submit);
    }

    @PreDestroy
    void stop() {
        executor.shutdownNow();
    }

    void process(UUID recordingId) {
        SoundRecording recording = recordings.find(recordingId).orElse(null);
        if (recording == null || recording.status() != SoundRecording.Status.processing) {
            return; // Deleted meanwhile, or already done.
        }
        Resource file = files.fileOf(recording.uploadId());
        Result result;
        try (InputStream in = file.getInputStream()) {
            result = WavAnalysis.analyse(in);
        }
        catch (Refused refused) {
            finish(recordingId, null, null, refused.getMessage());
            return;
        }
        catch (IOException ex) {
            throw new IllegalStateException("Could not read the upload of recording " + recordingId, ex);
        }
        String sha = files.sha256Of(recording.uploadId());
        String key = "sounds/" + sha + ".wav";
        try {
            blobs.copy("uploads/" + recording.uploadId(), key);
        }
        catch (IOException ex) {
            throw new IllegalStateException("Could not store recording " + recordingId, ex);
        }
        finish(recordingId, result, sha, null);
    }

    private void finish(UUID recordingId, Result result, String sha, String error) {
        tx.executeWithoutResult((status) -> {
            boolean changed = result != null
                    ? recordings.ready(recordingId, publicBase + "/assets/sounds/" + sha + ".wav", sha,
                            result.durationMs(), result.loudnessLufs(), result.peaks(), clock.instant())
                    : recordings.failed(recordingId, error, clock.instant());
            if (changed) {
                recordings.find(recordingId).ifPresent((done) -> events.publishEvent(done.toEvent()));
            }
        });
    }
}
