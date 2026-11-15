package app.keylab.shared.web;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Every response carries {@code KeyLab-API-Revision}, the date of the last
 * additive release of v1 (api-design-v1.md, Versioning). First in the chain,
 * ahead of the security filters, so 401 and 403 answers carry it too.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RevisionHeaderFilter extends OncePerRequestFilter {

    public static final String HEADER = "KeyLab-API-Revision";

    private final String revision;

    RevisionHeaderFilter(@Value("${keylab.api.revision}") String revision) {
        this.revision = revision;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader(HEADER, revision);
        chain.doFilter(request, response);
    }
}
