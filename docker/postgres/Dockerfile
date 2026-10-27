FROM postgres:16-alpine

# Build and install pgTAP for DB-level testing
RUN apk add --no-cache --virtual .build-deps make gcc musl-dev perl postgresql16-dev patch wget \
    && cd /tmp \
    && wget -q https://github.com/theory/pgtap/archive/refs/tags/v1.3.3.tar.gz \
    && tar xzf v1.3.3.tar.gz \
    && cd pgtap-1.3.3 \
    && make && make install \
    && cd / && rm -rf /tmp/pgtap-1.3.3 /tmp/v1.3.3.tar.gz \
    && apk del .build-deps
