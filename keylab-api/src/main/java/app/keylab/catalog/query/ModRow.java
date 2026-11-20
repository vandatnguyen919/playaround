package app.keylab.catalog.query;

import java.util.List;
import java.util.UUID;

/**
 * A mod the builder offers (CAT-07): its levels (null for a toggle mod) and
 * its effect on the four sliders, -3 to +3 each.
 */
public record ModRow(
        UUID id,
        String slug,
        String name,
        String description,
        List<String> levels,
        Effects effects,
        boolean live,
        int position) {

    public record Effects(int pitch, int thock, int volume, int rattle) {
    }
}
