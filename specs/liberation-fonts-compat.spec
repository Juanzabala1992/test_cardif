Name:           liberation-fonts-compat
Version:        1.0
Release:        1%{?dist}
Summary:        Compatibility package to provide liberation-fonts on UBI
License:        MIT
BuildArch:      noarch
Provides:       liberation-fonts
Requires:       liberation-fonts-common

%description
Compatibility RPM that provides the virtual package name liberation-fonts required by some RPMs.

%install
mkdir -p %{buildroot}/usr/share/doc/%{name}
echo "liberation-fonts compat" > %{buildroot}/usr/share/doc/%{name}/README

%files
/usr/share/doc/%{name}/README
