package app.keylab.sound.processing;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads one recording (US-38): a mono PCM WAV at 48 kHz and 24 bits, and
 * works out what the players need without decoding in the browser: length,
 * integrated loudness (ITU-R BS.1770-4, LUFS) and waveform peaks.
 *
 * <p>A file that does not fit is refused with a {@link Refused} whose message
 * the editor reads in the sound library.
 */
public final class WavAnalysis {

    public static final int SAMPLE_RATE = 48_000;
    public static final int BITS = 24;
    public static final int PEAKS = 64;

    private static final int FULL_SCALE = (1 << 23) - 1;
    private static final int FORMAT_PCM = 1;
    private static final int FORMAT_EXTENSIBLE = 0xFFFE;

    private WavAnalysis() {
    }

    /** What processing stores on a ready recording. */
    public record Result(int durationMs, BigDecimal loudnessLufs, List<Double> peaks) {
    }

    /** The file cannot be used; the message says why, for the editor. */
    public static final class Refused extends Exception {

        public Refused(String message) {
            super(message);
        }
    }

    public static Result analyse(InputStream in) throws IOException, Refused {
        byte[] bytes = in.readAllBytes();
        return analyse(bytes);
    }

    public static Result analyse(byte[] wav) throws Refused {
        if (wav.length < 12 || !ascii(wav, 0, "RIFF") || !ascii(wav, 8, "WAVE")) {
            throw new Refused("This is not a WAV file. Export the take as a 48 kHz, 24-bit mono WAV.");
        }
        int format = -1;
        int channels = 0;
        int rate = 0;
        int bits = 0;
        int dataStart = -1;
        int dataLength = 0;
        int at = 12;
        while (at + 8 <= wav.length) {
            String id = new String(wav, at, 4, java.nio.charset.StandardCharsets.US_ASCII);
            long size = u32(wav, at + 4);
            int body = at + 8;
            if (id.equals("fmt ") && size >= 16 && body + 16 <= wav.length) {
                format = u16(wav, body);
                channels = u16(wav, body + 2);
                rate = (int) u32(wav, body + 4);
                bits = u16(wav, body + 14);
                if (format == FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= wav.length) {
                    // The sub-format GUID starts with the real format code.
                    format = u16(wav, body + 24);
                }
            }
            else if (id.equals("data")) {
                dataStart = body;
                dataLength = (int) Math.min(size, wav.length - (long) body);
                break;
            }
            at = (int) Math.min(Integer.MAX_VALUE, body + size + (size & 1));
        }
        if (format == -1 || dataStart < 0) {
            throw new Refused("This WAV file is incomplete. Export it again.");
        }
        if (format != FORMAT_PCM || channels != 1 || rate != SAMPLE_RATE || bits != BITS) {
            throw new Refused("It is " + describe(format, rate, bits, channels)
                    + ". Upload a 48 kHz, 24-bit mono WAV.");
        }
        int frames = dataLength / 3;
        if (frames == 0) {
            throw new Refused("This WAV file has no sound in it.");
        }
        double[] samples = new double[frames];
        boolean clipped = false;
        for (int i = 0; i < frames; i++) {
            int p = dataStart + i * 3;
            int value = (wav[p] & 0xFF) | ((wav[p + 1] & 0xFF) << 8) | (wav[p + 2] << 16);
            if (value >= FULL_SCALE || value <= -FULL_SCALE) {
                clipped = true;
            }
            samples[i] = value / (double) (1 << 23);
        }
        if (clipped) {
            throw new Refused("It clips at 0 dBFS. Re-record a little quieter, peaks below −3 dB.");
        }
        int durationMs = (int) Math.round(frames * 1000.0 / SAMPLE_RATE);
        return new Result(durationMs, loudness(samples), peaks(samples, PEAKS));
    }

    /**
     * Integrated loudness, ITU-R BS.1770-4, one channel: K-weighting, 400 ms
     * blocks with 75 % overlap, the -70 LUFS absolute gate and the -10 LU
     * relative gate. A keystroke is shorter than one block, so a clip under
     * 400 ms is measured as one block over its whole length.
     *
     * @return LUFS to one decimal; -70.0 for a silent clip
     */
    static BigDecimal loudness(double[] samples) {
        double[] k = kWeighted(samples);
        int block = SAMPLE_RATE * 400 / 1000;
        int step = block / 4;
        List<Double> powers = new ArrayList<>();
        if (k.length < block) {
            powers.add(meanSquare(k, 0, k.length));
        }
        else {
            for (int start = 0; start + block <= k.length; start += step) {
                powers.add(meanSquare(k, start, start + block));
            }
        }
        double absolute = gatedMean(powers, Double.NEGATIVE_INFINITY);
        double gated = gatedMean(powers, -70);
        if (Double.isNaN(gated) && Double.isNaN(absolute)) {
            return BigDecimal.valueOf(-70.0).setScale(1);
        }
        double relativeGate = lufs(Double.isNaN(gated) ? absolute : gated) - 10;
        double result = gatedMean(powers, Math.max(-70, relativeGate));
        if (Double.isNaN(result)) {
            return BigDecimal.valueOf(-70.0).setScale(1);
        }
        return BigDecimal.valueOf(lufs(result)).setScale(1, RoundingMode.HALF_UP);
    }

    /** {@code count} values from 0 to 1: each slice's loudest sample, relative to the loudest of all. */
    static List<Double> peaks(double[] samples, int count) {
        double[] slices = new double[count];
        double max = 0;
        for (int i = 0; i < count; i++) {
            int from = (int) ((long) i * samples.length / count);
            int to = Math.max(from + 1, (int) ((long) (i + 1) * samples.length / count));
            double peak = 0;
            for (int j = from; j < Math.min(to, samples.length); j++) {
                peak = Math.max(peak, Math.abs(samples[j]));
            }
            slices[i] = peak;
            max = Math.max(max, peak);
        }
        List<Double> result = new ArrayList<>(count);
        for (double slice : slices) {
            double v = max == 0 ? 0 : slice / max;
            result.add(Math.round(v * 1000) / 1000.0);
        }
        return result;
    }

    /** The two BS.1770 pre-filters at 48 kHz: a high shelf, then the RLB high pass. */
    private static double[] kWeighted(double[] x) {
        double[] shelf = biquad(x, new double[] {1.53512485958697, -2.69169618940638, 1.19839281085285},
                new double[] {-1.69065929318241, 0.73248077421585});
        return biquad(shelf, new double[] {1.0, -2.0, 1.0}, new double[] {-1.99004745483398, 0.99007225036621});
    }

    private static double[] biquad(double[] x, double[] b, double[] a) {
        double[] y = new double[x.length];
        double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (int i = 0; i < x.length; i++) {
            double out = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
            x2 = x1;
            x1 = x[i];
            y2 = y1;
            y1 = out;
            y[i] = out;
        }
        return y;
    }

    private static double meanSquare(double[] x, int from, int to) {
        double sum = 0;
        for (int i = from; i < to; i++) {
            sum += x[i] * x[i];
        }
        return to > from ? sum / (to - from) : 0;
    }

    /** Mean power of the blocks louder than {@code gateLufs}; NaN when none is. */
    private static double gatedMean(List<Double> powers, double gateLufs) {
        double sum = 0;
        int n = 0;
        for (double power : powers) {
            if (power > 0 && lufs(power) > gateLufs) {
                sum += power;
                n++;
            }
        }
        return n == 0 ? Double.NaN : sum / n;
    }

    private static double lufs(double meanSquare) {
        return -0.691 + 10 * Math.log10(meanSquare);
    }

    private static String describe(int format, int rate, int bits, int channels) {
        String kind = format == FORMAT_PCM ? "" : format == 3 ? " float" : " compressed";
        String khz = rate % 1000 == 0 ? String.valueOf(rate / 1000) : String.valueOf(rate / 1000.0);
        String layout = channels == 1 ? "mono" : channels == 2 ? "stereo" : channels + "-channel";
        return khz + " kHz, " + bits + "-bit" + kind + " " + layout;
    }

    private static boolean ascii(byte[] b, int at, String text) {
        for (int i = 0; i < text.length(); i++) {
            if (b[at + i] != text.charAt(i)) {
                return false;
            }
        }
        return true;
    }

    private static int u16(byte[] b, int at) {
        return (b[at] & 0xFF) | ((b[at + 1] & 0xFF) << 8);
    }

    private static long u32(byte[] b, int at) {
        return (b[at] & 0xFFL) | ((b[at + 1] & 0xFFL) << 8) | ((b[at + 2] & 0xFFL) << 16) | ((b[at + 3] & 0xFFL) << 24);
    }
}
