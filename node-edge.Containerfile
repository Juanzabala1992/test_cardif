ARG NODE_BASE_IMAGE=registry.redhat.io/ubi9/nodejs-22:latest
FROM registry.redhat.io/ubi9/ubi:latest AS shim-builder
USER 0

RUN dnf -y install rpm-build redhat-rpm-config \
  && dnf clean all && rm -rf /var/cache/dnf /var/cache/yum

RUN mkdir -p /root/rpmbuild/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

RUN cat > /root/rpmbuild/SPECS/xdg-utils-compat.spec << 'EOF'
Name:           xdg-utils-compat
Version:        1.0
Release:        1%{?dist}
Summary:        Compatibility RPM to satisfy xdg-utils requirement
License:        MIT
BuildArch:      noarch
Provides:       xdg-utils
Provides:       xdg-open

%description
Compatibility RPM providing xdg-utils requirements for third-party packages on UBI.

%install
mkdir -p %{buildroot}/usr/share/doc/%{name}
echo "Compatibility RPM: provides xdg-utils" > %{buildroot}/usr/share/doc/%{name}/README

%files
/usr/share/doc/%{name}/README
EOF

RUN rpmbuild -ba /root/rpmbuild/SPECS/xdg-utils-compat.spec

RUN cat > /root/rpmbuild/SPECS/liberation-fonts-compat.spec << 'EOF'
Name:           liberation-fonts-compat
Version:        1.0
Release:        1%{?dist}
Summary:        Compatibility RPM to satisfy liberation-fonts requirement
License:        MIT
BuildArch:      noarch
Provides:       liberation-fonts

%description
Compatibility RPM providing liberation-fonts requirement for third-party packages on UBI.

%install
mkdir -p %{buildroot}/usr/share/doc/%{name}
echo "Compatibility RPM: provides liberation-fonts" > %{buildroot}/usr/share/doc/%{name}/README

%files
/usr/share/doc/%{name}/README
EOF

RUN rpmbuild -ba /root/rpmbuild/SPECS/liberation-fonts-compat.spec

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

COPY --from=shim-builder /root/rpmbuild/RPMS/noarch/*.rpm /var/tmp/
RUN dnf -y install /var/tmp/*.rpm \
  && rm -f /var/tmp/*.rpm \
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

ENV EDGE_BIN=/usr/bin/microsoft-edge-stable

CMD ["node", "-v"]
