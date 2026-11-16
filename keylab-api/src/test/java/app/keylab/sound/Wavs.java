package app.keylab.sound;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

import javax.imageio.ImageIO;

/** Test files: PCM WAVs of a decaying click or a steady sine, and PNGs. */
public final class Wavs {

    private Wavs() {
    }

    /** A keystroke-like click: 100 ms of silence, then a 1 kHz burst that decays, at {@code amplitude}. */
    public static double[] click(int rate, double seconds, double amplitude) {
        int n = (int) (rate * seconds);
        double[] samples = new double[n];
        int start = rate / 10;
        for (int i = start; i < n; i++) {
            double t = (i - start) / (double) rate;
            samples[i] = amplitude * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 1000 * t);
        }
        return samples;
    }

    public static double[] sine(int rate, double seconds, double amplitude, double hz) {
        int n = (int) (rate * seconds);
        double[] samples = new double[n];
        for (int i = 0; i < n; i++) {
            samples[i] = amplitude * Math.sin(2 * Math.PI * hz * i / rate);
        }
        return samples;
    }

    /** The upload the checklist asks for: 48 kHz, 24-bit, mono. */
    public static byte[] good() {
        return encode(click(48_000, 0.2, 0.5), 48_000, 24, 1);
    }

    public static byte[] encode(double[] samples, int rate, int bits, int channels) {
        int bytesPerSample = bits / 8;
        int dataLength = samples.length * bytesPerSample * channels;
        ByteArrayOutputStream out = new ByteArrayOutputStream(44 + dataLength);
        ascii(out, "RIFF");
        le(out, 36 + dataLength, 4);
        ascii(out, "WAVE");
        ascii(out, "fmt ");
        le(out, 16, 4);
        le(out, 1, 2);
        le(out, channels, 2);
        le(out, rate, 4);
        le(out, (long) rate * channels * bytesPerSample, 4);
        le(out, channels * bytesPerSample, 2);
        le(out, bits, 2);
        ascii(out, "data");
        le(out, dataLength, 4);
        long full = (1L << (bits - 1)) - 1;
        for (double sample : samples) {
            long value = Math.round(Math.max(-1, Math.min(1, sample)) * full);
            for (int c = 0; c < channels; c++) {
                le(out, value, bytesPerSample);
            }
        }
        return out.toByteArray();
    }

    public static byte[] png(int width, int height) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        }
        catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        return out.toByteArray();
    }

    private static void ascii(ByteArrayOutputStream out, String text) {
        out.writeBytes(text.getBytes(StandardCharsets.US_ASCII));
    }

    private static void le(ByteArrayOutputStream out, long value, int bytes) {
        for (int i = 0; i < bytes; i++) {
            out.write((int) (value >> (8 * i)) & 0xFF);
        }
    }
}
