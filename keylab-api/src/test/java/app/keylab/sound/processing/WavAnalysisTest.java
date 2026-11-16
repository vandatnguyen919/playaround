package app.keylab.sound.processing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.nio.charset.StandardCharsets;

import app.keylab.sound.Wavs;
import app.keylab.sound.processing.WavAnalysis.Refused;
import app.keylab.sound.processing.WavAnalysis.Result;

import org.junit.jupiter.api.Test;

/**
 * Processing a take (US-38): only 48 kHz, 24-bit mono WAVs pass, clipping is
 * refused, and length, loudness and peaks come out right.
 */
class WavAnalysisTest {

    @Test
    void measuresLengthPeaksAndLoudness() throws Exception {
        Result result = WavAnalysis.analyse(Wavs.good());
        assertThat(result.durationMs()).isEqualTo(200);
        assertThat(result.peaks()).hasSize(WavAnalysis.PEAKS);
        assertThat(result.peaks()).allSatisfy((p) -> assertThat(p).isBetween(0.0, 1.0));
        assertThat(result.peaks()).contains(1.0);
        // The first 100 ms are silent, as the checklist asks: the first half of the peaks is zero.
        assertThat(result.peaks().subList(0, 30)).containsOnly(0.0);
        assertThat(result.loudnessLufs().doubleValue()).isBetween(-40.0, -10.0);
    }

    @Test
    void loudnessFollowsBs1770() throws Exception {
        // BS.1770: a 1 kHz sine at 0 dBFS reads -3.01 LUFS, so -20 dBFS reads about -23.
        Result long1k = WavAnalysis.analyse(Wavs.encode(Wavs.sine(48_000, 3, 0.1, 1000), 48_000, 24, 1));
        assertThat(long1k.loudnessLufs().doubleValue()).isCloseTo(-23.0, within(0.2));
        assertThat(long1k.durationMs()).isEqualTo(3000);

        // Under one 400 ms block, the clip is measured as one block: same answer.
        Result short1k = WavAnalysis.analyse(Wavs.encode(Wavs.sine(48_000, 0.2, 0.1, 1000), 48_000, 24, 1));
        assertThat(short1k.loudnessLufs().doubleValue()).isCloseTo(-23.0, within(0.3));

        Result silent = WavAnalysis.analyse(Wavs.encode(new double[4800], 48_000, 24, 1));
        assertThat(silent.loudnessLufs().doubleValue()).isEqualTo(-70.0);
        assertThat(silent.peaks()).containsOnly(0.0);
    }

    @Test
    void refusesOtherFormatsAndSaysWhatItGot() {
        assertThatThrownBy(() -> WavAnalysis.analyse(Wavs.encode(Wavs.click(44_100, 0.2, 0.5), 44_100, 16, 2)))
            .isInstanceOf(Refused.class)
            .hasMessage("It is 44.1 kHz, 16-bit stereo. Upload a 48 kHz, 24-bit mono WAV.");
        assertThatThrownBy(() -> WavAnalysis.analyse(Wavs.encode(Wavs.click(48_000, 0.2, 0.5), 48_000, 24, 2)))
            .isInstanceOf(Refused.class)
            .hasMessageContaining("48 kHz, 24-bit stereo");
        assertThatThrownBy(() -> WavAnalysis.analyse("fLaC not a wav".getBytes(StandardCharsets.US_ASCII)))
            .isInstanceOf(Refused.class)
            .hasMessageStartingWith("This is not a WAV file.");
    }

    @Test
    void refusesClipping() {
        assertThatThrownBy(() -> WavAnalysis.analyse(Wavs.encode(Wavs.click(48_000, 0.2, 1.4), 48_000, 24, 1)))
            .isInstanceOf(Refused.class)
            .hasMessageStartingWith("It clips at 0 dBFS.");
    }
}
