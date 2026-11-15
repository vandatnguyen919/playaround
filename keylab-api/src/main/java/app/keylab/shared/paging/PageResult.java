package app.keylab.shared.paging;

import java.util.List;
import java.util.function.Function;

/**
 * A list response: {@code { "data": [...], "page": { "nextPageToken": "...", "pageSize": 24 } }}.
 * {@code nextPageToken} is null on the last page.
 */
public record PageResult<T>(List<T> data, PageInfo page) {

    public record PageInfo(String nextPageToken, int pageSize) {
    }

    /**
     * Builds a page from rows fetched with {@link PageQuery#limit()} (one more
     * than the page size). The extra row is dropped and tells that a next page
     * exists; the cursor is taken from the last row kept.
     */
    public static <T> PageResult<T> of(List<T> rows, PageQuery query, Function<T, Cursor> cursorOf) {
        boolean more = rows.size() > query.pageSize();
        List<T> data = more ? List.copyOf(rows.subList(0, query.pageSize())) : List.copyOf(rows);
        String next = more ? cursorOf.apply(data.get(data.size() - 1)).encode() : null;
        return new PageResult<>(data, new PageInfo(next, query.pageSize()));
    }

    /** The same page with each item mapped, for example entity to response model. */
    public <R> PageResult<R> map(Function<T, R> mapper) {
        return new PageResult<>(data.stream().map(mapper).toList(), page);
    }
}
