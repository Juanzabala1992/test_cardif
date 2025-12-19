ARG NODE_BASE_IMAGE=registry.redhat.io/ubi9/nodejs-22:latest
FROM ${NODE_BASE_IMAGE}

USER 0

RUN dnf -y install \
    ca-certificates \
    fontconfig \
    freetype \
    liberation-fonts-common \
    alsa-lib \
    atk \
    cups-libs \
    gtk3 \
    libX11 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXrender \
    libXScrnSaver \
    libXtst \
    pango \
    nss \
    nss-tools \
    mesa-libgbm \
    mesa-dri-drivers \
    libdrm \
    wget \
    which \
    unzip \
  && dnf clean all && rm -rf /var/cache/dnf /var/cache/yum

COPY rpms/*.rpm /tmp/
RUN dnf -y install /tmp/*.rpm \
  && rm -f /tmp/*.rpm \
  && dnf clean all && rm -rf /var/cache/dnf /var/cache/yum

RUN rpm --import https://packages.microsoft.com/keys/microsoft.asc && \
  cat > /etc/yum.repos.d/microsoft-edge.repo << 'EOF'
[microsoft-edge]
name=Microsoft Edge for Linux - $basearch
baseurl=https://packages.microsoft.com/yumrepos/edge
enabled=1
gpgcheck=1
gpgkey=https://packages.microsoft.com/keys/microsoft.asc
EOF

RUN dnf -y install microsoft-edge-stable \
  && dnf clean all && rm -rf /var/cache/dnf /var/cache/yum

USER 1001
WORKDIR /opt/app-root/src

COPY package*.json ./
RUN npm install

COPY . .

ENV EDGE_BIN=/usr/bin/microsoft-edge-stable

CMD ["node", "-v"]
