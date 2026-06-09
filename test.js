const { execSync } = require("child_process");

function run(cmd, name) {
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    console.log(`[OK] ${name}: ${out}`);
    return true;
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : "";
    const stderr = e.stderr ? e.stderr.toString() : "";
    console.error(`[FAIL] ${name}: Command failed: ${cmd}`);
    if (stdout) console.error(stdout.trim());
    if (stderr) console.error(stderr.trim());
    return false;
  }
}

function exists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("=== Smoke test Node + Chrome/Edge ===");
console.log(`[INFO] Node: ${process.version}`);

const chromeEnv = process.env.CHROME_BIN;
const edgeEnv = process.env.EDGE_BIN;

// defaults “oficiales”
const chromeDefault = "google-chrome-stable";
const edgeDefault = "microsoft-edge-stable";

// decide qué probar, basado en lo que realmente existe en la imagen
let testedAny = false;

// Chrome (solo si existe el binario)
const chromeCandidate = chromeEnv || chromeDefault;
console.log(`[INFO] CHROME_BIN: ${chromeEnv || "(not set)"} (candidate: ${chromeCandidate})`);
if (exists(chromeCandidate)) {
  testedAny = true;
  const ok = run(`${chromeCandidate} --version`, "Google Chrome");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Google Chrome: ${chromeCandidate} not found in image`);
}

// Edge (solo si existe el binario)
const edgeCandidate = edgeEnv || edgeDefault;
console.log(`[INFO] EDGE_BIN: ${edgeEnv || "(not set)"} (candidate: ${edgeCandidate})`);
if (exists(edgeCandidate)) {
  testedAny = true;
  const ok = run(`${edgeCandidate} --version`, "Microsoft Edge");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Microsoft Edge: ${edgeCandidate} not found in image`);
}

if (!testedAny) {
  console.error("[FAIL] No browsers found (neither Chrome nor Edge).");
  process.exit(1);
}

console.log("✅ Todo OK");

**********************************************************************************************
  *************************************************************************************



  # OpenShift Enterprise Platform Presentation Script

## Slide 1 — Introduction

Good morning everyone.

My name is Juan, and today I would like to give you a brief overview of our OpenShift Enterprise Platform for the LATAM region.

During this presentation, I will explain the general architecture, how our DevOps process is integrated with the platform, the main benefits we have achieved, and the current challenges related to cloud-native adoption.

The main idea of this presentation is to show how OpenShift has become a stable enterprise platform that supports automation, security, observability, and business continuity.


---

## Slide 2 — OpenShift On-Premise Overview

This slide presents our OpenShift on-premise enterprise architecture.

Our platform is deployed across two main sites.

The first one is the Primary Site, where the main workloads are running.

The second one is the Disaster Recovery Site, or DRS, which supports business continuity in case the primary site becomes unavailable.

In the Primary Site, we separate workloads into different clusters according to their purpose.

We have a Platform Services cluster, which provides shared services for the entire platform.

We also have an Internal Applications cluster, dedicated to internal business applications.

And we have a Presentation cluster, which is designed for applications and APIs exposed to external channels or external consumers.

This separation helps us improve security, workload isolation, operational stability, and independent scalability.

The platform also includes several shared services.

Quay is used as our enterprise container registry. It stores and manages the container images used by the platform.

ACS, or Advanced Cluster Security, provides security capabilities for container workloads and OpenShift environments.

Dynatrace is used for observability and monitoring.

And LAAS provides centralized logging as a service.

Regarding Disaster Recovery, the DRS deployment is not always automatic. The CI/CD pipeline includes an optional stage to deploy into the Disaster Recovery Site when it is required by the project or by operational needs.

Another important point is that the CI/CD framework is standardized and maintained by our ALM team.

This allows development teams to focus on delivering code, while the platform and automation process handle the operational complexity.

---

## Slide 3 — DevOps Overview

This slide shows our standardized DevOps framework.

The main objective is to provide a reusable and automated CI/CD process across the organization.

Developers only need to commit their code into the source repository.

From that point, the Jenkins Shared Library, maintained by our ALM team, executes the standardized pipeline automatically.

The pipeline includes several automated stages.

It starts with the source code checkout.

Then, the application is built.

After that, unit tests are executed.

The pipeline also performs code quality validation, package generation, container image validation, image signing, and finally deployment into OpenShift.

The main benefit is that we do not need to create a completely different pipeline for every project.

Instead, we use a shared and reusable framework.

This provides process standardization, integrated security controls, reduced manual operations, consistent developer experience, centralized governance, and scalable enterprise operations.

Another important advantage is that the same pipeline can be reused across different technologies.

For example, the application can be built with Java, Node.js, Nginx, or other supported technologies, but the deployment process remains standardized.

This approach allows us to achieve standardization, reuse, and automation.

As a result, we reduce delivery time, operational risk, and manual effort.

One point to clarify is that the exact implementation details for image scanning and image signing are managed by the ALM team.



---

## Slide 4 — General Overview / OpenShift Architecture with DevOps Integration

This slide combines the DevOps process with our OpenShift platform architecture.

On the left side, we have the DevOps team, which provides a standardized onboarding process for new microservices.

Thanks to automation, the onboarding process for a new microservice can be completed in less than one hour.

The platform automation helps manage components such as ConfigMaps, Secrets, and Certificates.

This reduces operational support activities and allows development teams to focus more on business functionality.

In the center of the slide, we can see the DevOps pipeline.

Developers commit their code, and the standardized CI/CD process takes care of validation, build, security controls, and deployment.

Again, the automation framework is maintained by the ALM team through Jenkins Shared Libraries.

On the right side, we have the OpenShift platform.

Applications are deployed into the Internal Applications cluster or the Presentation cluster, depending on the workload requirements.

The Presentation cluster is used for workloads exposed to external channels, while the Internal Applications cluster is used for internal business applications.

The platform also includes shared services such as Quay, ACS, Dynatrace, and LAAS.

For business continuity, the pipeline also supports deployment into the Disaster Recovery Site.

This DRS deployment is optional and is executed only when required by the project or operational needs.

Overall, this architecture allows us to combine automation, security, observability, and platform standardization into a single enterprise solution.

---

## Slide 5 — Cloud-Native Adoption Challenges

This slide explains the current challenges after building a mature OpenShift platform.

At this point, our OpenShift platform has reached a good level of maturity.

Most operational challenges are no longer related to the platform itself, but to how applications adopt cloud-native principles.

The platform already provides several enterprise capabilities.

First, it reduces dependencies by giving development teams more autonomy.

Second, it enables scalable operations through standardization and automation.

And finally, security is integrated by default as part of the development lifecycle.

However, applications still need to be properly designed to fully benefit from these capabilities.

Our current focus areas are resilience and scalability.

For resilience, applications must properly handle failures and recovery scenarios.

In distributed environments, temporary failures can happen, so applications need to recover gracefully.

For scalability, applications must efficiently manage resources and external connections.

OpenShift can scale workloads and provide platform capabilities, but the application design is still very important.

One of the key lessons we have learned is that OpenShift provides a very powerful platform, but a container platform by itself does not replace good development practices.

Applications still need proper database connection pooling, correct Kafka producer and consumer configuration, good retry mechanisms, health checks, and appropriate resource sizing.

To support development teams, we provide shared best practices, technical coaching, and a shared knowledge base.

In summary, building the platform was the first step.

The next challenge is helping applications fully use the capabilities that OpenShift already provides.

---

## Slide 6 — Summary

To close the presentation, this slide summarizes the main lessons learned from our OpenShift enterprise platform journey.

First, the platform has proven to be stable and reliable for enterprise workloads.

One important result is that we have not had platform-wide critical incidents during the last three years of operation.

Second, the initial investment was significant.

Standardization, automation, and governance required effort at the beginning, but they simplified future operations and made the platform easier to manage.

Third, observability became a critical capability.

Dynatrace is now one of the most valuable components of the platform because it helps us monitor application behavior, identify issues, and support troubleshooting activities.

Another important point is that developers can now focus more on business logic instead of infrastructure complexity.

Through automation and self-service, the platform reduces manual tasks related to ConfigMaps, Secrets, Certificates, and deployment activities.

Disaster Recovery was also incorporated as part of the design.

This is important because resilience and business continuity cannot be treated as an afterthought.

Finally, the next challenge is cloud-native adoption.

The platform is already mature, but now we need to help development teams design applications that fully use the capabilities provided by OpenShift.

Developer autonomy is increasing, but support is still very important during the onboarding phase.

In conclusion, OpenShift has become a stable enterprise platform for us.

Now the focus is shifting from building the platform to helping teams use it in the best possible way.

Thank you very much.

I will be happy to answer any questions.

---

# Possible Questions and Answers

## 1. What is the purpose of the Presentation cluster?

The Presentation cluster is used for applications and APIs exposed to external channels or external consumers.

We separate these workloads from internal applications because they have different security, traffic, and operational requirements.

This separation improves isolation and reduces risk.

---

## 2. What is the difference between the Internal Applications cluster and the Presentation cluster?

The Internal Applications cluster is used for internal business applications.

The Presentation cluster is used for workloads exposed to external channels.

The main difference is the type of consumers and the security requirements.

---

## 3. What is Quay?

Quay is our enterprise container registry.

It stores and manages the approved container images used by OpenShift.

During the CI/CD process, the pipeline builds the container image and pushes it to the registry.

Then, OpenShift pulls the image from the registry during deployment.

---

## 4. What is ACS?

ACS stands for Advanced Cluster Security.

It provides security capabilities for container images and OpenShift workloads.

It helps identify vulnerabilities, enforce security policies, and monitor workloads.

---

## 5. Is the DRS deployment automatic?

No, not always.

The pipeline includes an optional stage for Disaster Recovery deployment.

This stage is executed only when required by the project or by operational needs.

---

## 6. How is DRS involved in the flow?

The normal deployment goes to the Primary Site.

When required, the same pipeline can also trigger a deployment into the Disaster Recovery Site.

This allows the application to be available in the recovery site for business continuity purposes.

---

## 7. Who manages the CI/CD pipelines?

The CI/CD framework is maintained by the ALM team.

They provide the Jenkins Shared Libraries and the standardized deployment process.

Development teams use the framework, but ALM owns and maintains the implementation.

---

## 8. What is the role of the OpenShift team?

The OpenShift team manages the platform itself.

This includes cluster lifecycle, capacity management, network policies, security controls, observability, and disaster recovery support.

The OpenShift team also supports application onboarding and helps development teams use the platform correctly.

---

## 9. What does “developers only commit code” mean?

It means developers do not need to manually manage all deployment steps.

They commit the code, and the automated pipeline handles build, testing, code quality validation, image creation, security controls, and deployment.

---

## 10. What is the benefit of Jenkins Shared Libraries?

Jenkins Shared Libraries allow us to reuse the same pipeline logic across multiple projects.

This improves standardization, reduces duplicated effort, and makes the deployment process more consistent.

---

## 11. What tools are used for image scanning and image signing?

The pipeline includes image scanning and image signing stages.

The exact implementation details are managed by the ALM team.

My understanding is that image scanning may be related to ACS and image signing may be related to Cosign, but I would confirm those details with the ALM team.

---

## 12. Why do you say OpenShift does not replace good development practices?

Because OpenShift provides platform capabilities such as deployment automation, scaling, monitoring, and resilience mechanisms.

However, applications still need to be designed correctly.

For example, applications must manage database connections, retries, Kafka consumers and producers, health checks, and resource usage properly.

---

## 13. What are readiness and liveness probes?

Liveness probes verify whether the application is still running correctly.

Readiness probes verify whether the application is ready to receive traffic.

These probes help OpenShift manage application availability.

---

## 14. What is the main current challenge?

The main current challenge is cloud-native adoption.

The platform is already mature, but applications must also be designed to fully benefit from the platform capabilities.

---

## 15. Why is Dynatrace important?

Dynatrace is important because it provides observability.

It helps us monitor application behavior, identify issues, analyze performance, and support troubleshooting activities.

---

## 16. What is LAAS?

LAAS means Logging as a Service.

It provides centralized logging so that application and platform logs can be collected and analyzed in a common place.

---

## 17. What are the main benefits of the platform?

The main benefits are standardization, automation, security, observability, disaster recovery, and reduced operational effort.

The platform also allows development teams to focus more on business logic instead of infrastructure tasks.

---

## 18. What is the final message of the presentation?

The final message is that OpenShift has become a stable enterprise platform.

Now the focus is shifting from building the platform to helping development teams fully adopt cloud-native principles and use the platform in the best possible way.
