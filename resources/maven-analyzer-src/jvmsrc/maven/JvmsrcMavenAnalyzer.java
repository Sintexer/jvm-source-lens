package jvmsrc.maven;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.inject.Inject;
import org.apache.maven.AbstractMavenLifecycleParticipant;
import org.apache.maven.MavenExecutionException;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.model.Plugin;
import org.apache.maven.project.DefaultDependencyResolutionRequest;
import org.apache.maven.project.DependencyResolutionException;
import org.apache.maven.project.DependencyResolutionResult;
import org.apache.maven.project.MavenProject;
import org.apache.maven.project.ProjectDependenciesResolver;
import org.eclipse.aether.DefaultRepositorySystemSession;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.artifact.Artifact;
import org.eclipse.aether.artifact.DefaultArtifact;
import org.eclipse.aether.collection.DependencyCollectionContext;
import org.eclipse.aether.collection.DependencySelector;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;
import org.eclipse.aether.resolution.ArtifactRequest;
import org.eclipse.aether.resolution.ArtifactResult;
import org.eclipse.aether.repository.RemoteRepository;
import org.eclipse.aether.util.graph.selector.AndDependencySelector;
import org.eclipse.aether.util.graph.selector.ExclusionDependencySelector;
import org.eclipse.aether.util.graph.selector.OptionalDependencySelector;
import org.eclipse.aether.util.graph.selector.ScopeDependencySelector;

/**
 * Maven lifecycle participant invoked via {@code -Dmaven.ext.class.path=...} that emits
 * {@code ResolutionOutput} JSON (schema 1.2) or resolves a single {@code -sources.jar} on demand,
 * then strips all in-memory build plugins so {@code validate} runs zero goals and writes nothing
 * under the scanned project tree.
 */
public final class JvmsrcMavenAnalyzer extends AbstractMavenLifecycleParticipant {

  private static final Pattern XML_RELEASE_TAG =
      Pattern.compile("<release>\\s*([^<\\s]+)\\s*</release>");
  private static final Pattern XML_SOURCE_TAG =
      Pattern.compile("<source>\\s*([^<\\s]+)\\s*</source>");

  @Inject private ProjectDependenciesResolver projectDependenciesResolver;
  @Inject private RepositorySystem repositorySystem;

  /**
   * Filters direct dependencies (depth <= 1) by {@code allowedDirectScopes} before conflict
   * mediation, and delegates deeper transitive edges to {@link ScopeDependencySelector}.
   * Without depth-1 filtering, a direct {@code test} dependency mediates away a transitive
   * {@code compile} dependency when resolving the {@code compile} classpath.
   */
  static final class ClasspathScopeSelector implements DependencySelector {
    private final Set<String> allowedDirectScopes;
    private final DependencySelector transitiveSelector;
    private final int depth;

    ClasspathScopeSelector(Collection<String> allowedDirect, Collection<String> excludedTransitive) {
      this(
          new HashSet<String>(allowedDirect),
          new ScopeDependencySelector(null, excludedTransitive),
          0);
    }

    private ClasspathScopeSelector(
        Set<String> allowedDirectScopes, DependencySelector transitiveSelector, int depth) {
      this.allowedDirectScopes = allowedDirectScopes;
      this.transitiveSelector = transitiveSelector;
      this.depth = depth;
    }

    @Override
    public boolean selectDependency(Dependency dependency) {
      if (dependency == null) {
        return true;
      }
      if (depth <= 1) {
        return allowedDirectScopes.contains(dependency.getScope());
      }
      return transitiveSelector.selectDependency(dependency);
    }

    @Override
    public DependencySelector deriveChildSelector(DependencyCollectionContext context) {
      DependencySelector nextTransitive =
          depth == 0 ? transitiveSelector : transitiveSelector.deriveChildSelector(context);
      return new ClasspathScopeSelector(allowedDirectScopes, nextTransitive, depth + 1);
    }

    @Override
    public boolean equals(Object obj) {
      if (this == obj) {
        return true;
      }
      if (!(obj instanceof ClasspathScopeSelector)) {
        return false;
      }
      ClasspathScopeSelector other = (ClasspathScopeSelector) obj;
      return depth == other.depth
          && allowedDirectScopes.equals(other.allowedDirectScopes)
          && transitiveSelector.equals(other.transitiveSelector);
    }

    @Override
    public int hashCode() {
      int result = allowedDirectScopes.hashCode();
      result = 31 * result + transitiveSelector.hashCode();
      result = 31 * result + depth;
      return result;
    }
  }

  @Override
  public void afterProjectsRead(MavenSession session) throws MavenExecutionException {
    String mode = System.getProperty("jvmsrc.mode", "").trim();
    if (mode.isEmpty()) {
      return;
    }

    Integer toolchainMajor = detectToolchainMajorOrNull(session.getProjects());

    // Strip all build plugins from in-memory project models so `validate` executes zero mojos
    // (enforcer, jacoco, git-commit-id, antrun, etc.) and never creates `target/`.
    for (MavenProject project : session.getProjects()) {
      if (project.getBuild() != null && project.getBuild().getPlugins() != null) {
        project.getBuild().getPlugins().clear();
      }
    }

    try {
      String json;
      if ("sources".equals(mode)) {
        json = runSourcesMode(session);
      } else if ("resolve".equals(mode)) {
        json = runResolveMode(session, toolchainMajor);
      } else {
        throw new MavenExecutionException("Unsupported jvmsrc.mode: " + mode, (Throwable) null);
      }
      emitOutput(json);
    } catch (MavenExecutionException e) {
      throw e;
    } catch (Exception e) {
      throw new MavenExecutionException(
          "jvmsrc Maven analysis failed: " + (e.getMessage() != null ? e.getMessage() : e.toString()),
          e);
    }
  }

  private String runSourcesMode(MavenSession session) throws MavenExecutionException {
    String group = System.getProperty("jvmsrc.group", "").trim();
    String artifactId = System.getProperty("jvmsrc.artifact", "").trim();
    String version = System.getProperty("jvmsrc.version", "").trim();
    if (group.isEmpty() || artifactId.isEmpty() || version.isEmpty()) {
      throw new MavenExecutionException(
          "jvmsrc sources mode requires -Djvmsrc.group, -Djvmsrc.artifact, -Djvmsrc.version",
          (Throwable) null);
    }

    List<RemoteRepository> repos = collectRemoteRepositories(session.getProjects());
    DefaultArtifact sourcesArtifact =
        new DefaultArtifact(group, artifactId, "sources", "jar", version);
    ArtifactRequest req = new ArtifactRequest(sourcesArtifact, repos, null);

    String sourcesPath = null;
    try {
      ArtifactResult res = repositorySystem.resolveArtifact(session.getRepositorySession(), req);
      if (res.getArtifact() != null && res.getArtifact().getFile() != null) {
        sourcesPath = res.getArtifact().getFile().getAbsolutePath();
      }
    } catch (Exception ignored) {
      // Artifact has no published -sources.jar (or unavailable); caller falls back to CFR.
    }

    return "{\"sourcesJarPath\":" + jsonStringOrNull(sourcesPath) + "}";
  }

  private List<RemoteRepository> collectRemoteRepositories(List<MavenProject> projects) {
    Map<String, RemoteRepository> unique = new LinkedHashMap<String, RemoteRepository>();
    for (MavenProject project : projects) {
      if (project.getRemoteProjectRepositories() == null) {
        continue;
      }
      for (RemoteRepository repo : project.getRemoteProjectRepositories()) {
        String key = repo.getId() + "|" + repo.getUrl();
        if (!unique.containsKey(key)) {
          unique.put(key, repo);
        }
      }
    }
    return new ArrayList<RemoteRepository>(unique.values());
  }

  private String runResolveMode(MavenSession session, Integer toolchainMajor)
      throws MavenExecutionException {
    String projectRootProp = System.getProperty("jvmsrc.projectRoot", "").trim();
    String projectRoot =
        !projectRootProp.isEmpty()
            ? projectRootProp
            : session.getTopLevelProject().getBasedir().getAbsolutePath();
    boolean wrapper = "true".equalsIgnoreCase(System.getProperty("jvmsrc.wrapper", "false"));
    String mavenVersion = detectMavenVersion(session);

    Map<String, MavenProject> reactorByGav = new HashMap<String, MavenProject>();
    for (MavenProject p : session.getProjects()) {
      reactorByGav.put(reactorKey(p.getGroupId(), p.getArtifactId(), p.getVersion()), p);
    }

    StringBuilder sb = new StringBuilder(4096);
    sb.append("{");
    sb.append("\"schemaVersion\":\"1.2\",");
    sb.append("\"resolvedAt\":").append(jsonString(Instant.now().toString())).append(",");
    sb.append("\"buildSystem\":{");
    sb.append("\"type\":\"maven\",");
    sb.append("\"version\":").append(jsonString(mavenVersion)).append(",");
    sb.append("\"wrapper\":").append(wrapper);
    sb.append("},");
    sb.append("\"projectRoot\":").append(jsonString(projectRoot)).append(",");
    sb.append("\"modules\":[");

    List<MavenProject> projects = session.getProjects();
    for (int i = 0; i < projects.size(); i++) {
      if (i > 0) {
        sb.append(",");
      }
      MavenProject project = projects.get(i);
      appendModuleJson(sb, session, project, reactorByGav);
    }

    sb.append("],");
    sb.append("\"errors\":[]");
    if (toolchainMajor != null && toolchainMajor.intValue() > 0) {
      sb.append(",\"javaToolchainVersion\":").append(toolchainMajor.intValue());
    }
    sb.append("}");
    return sb.toString();
  }

  private void appendModuleJson(
      StringBuilder sb,
      MavenSession session,
      MavenProject project,
      Map<String, MavenProject> reactorByGav)
      throws MavenExecutionException {
    String moduleName = project.getArtifactId();
    String moduleDir = project.getBasedir().getAbsolutePath();

    sb.append("{");
    sb.append("\"name\":").append(jsonString(moduleName)).append(",");
    sb.append("\"path\":").append(jsonString(moduleDir)).append(",");
    sb.append("\"configurations\":[");

    boolean purePomAggregator =
        "pom".equals(project.getPackaging())
            && (project.getDependencies() == null || project.getDependencies().isEmpty());

    if (!purePomAggregator) {
      appendConfigurationJson(
          sb,
          session,
          project,
          reactorByGav,
          "compile",
          "compile",
          Arrays.asList("compile", "provided", "system"),
          Arrays.asList("test", "runtime", "provided", "system"));
      sb.append(",");
      appendConfigurationJson(
          sb,
          session,
          project,
          reactorByGav,
          "runtime",
          "runtime",
          Arrays.asList("compile", "runtime"),
          Arrays.asList("test", "provided", "system"));
      sb.append(",");
      appendConfigurationJson(
          sb,
          session,
          project,
          reactorByGav,
          "test",
          "test-compile",
          Arrays.asList("compile", "provided", "runtime", "test", "system"),
          Arrays.asList("test", "provided", "system"));
    }

    sb.append("]}");
  }

  private void appendConfigurationJson(
      StringBuilder sb,
      MavenSession session,
      MavenProject project,
      final Map<String, MavenProject> reactorByGav,
      String configName,
      String schemaScope,
      Collection<String> allowedDirectScopes,
      Collection<String> excludedTransitiveScopes)
      throws MavenExecutionException {
    DefaultRepositorySystemSession scopedSession =
        new DefaultRepositorySystemSession(session.getRepositorySession());
    scopedSession.setDependencySelector(
        new AndDependencySelector(
            new ClasspathScopeSelector(allowedDirectScopes, excludedTransitiveScopes),
            new OptionalDependencySelector(),
            new ExclusionDependencySelector()));

    DefaultDependencyResolutionRequest req =
        new DefaultDependencyResolutionRequest(project, scopedSession);
    req.setResolutionFilter(
        (node, parents) -> {
          Dependency dep = node.getDependency();
          if (dep == null || dep.getArtifact() == null) {
            return true;
          }
          Artifact a = dep.getArtifact();
          String key = reactorKey(a.getGroupId(), a.getArtifactId(), a.getBaseVersion());
          return !reactorByGav.containsKey(key);
        });

    DependencyResolutionResult res;
    try {
      res = projectDependenciesResolver.resolve(req);
    } catch (DependencyResolutionException dre) {
      throw new MavenExecutionException(
          "Could not resolve dependencies for module "
              + project.getArtifactId()
              + " ("
              + configName
              + "): "
              + dre.getMessage(),
          dre);
    }

    DependencyNode root = res.getDependencyGraph();
    Set<String> directKeys = new HashSet<String>();
    if (root != null) {
      for (DependencyNode child : root.getChildren()) {
        Dependency d = child.getDependency();
        if (d != null && d.getArtifact() != null) {
          Artifact ca = d.getArtifact();
          directKeys.add(ca.getGroupId() + ":" + ca.getArtifactId() + ":" + ca.getClassifier());
        }
      }
    }

    List<DependencyNode> preorder = new ArrayList<DependencyNode>();
    if (root != null) {
      collectPreorder(root, preorder);
    }

    sb.append("{");
    sb.append("\"name\":").append(jsonString(configName)).append(",");
    sb.append("\"scope\":").append(jsonString(schemaScope)).append(",");
    sb.append("\"artifacts\":[");

    Set<String> seen = new HashSet<String>();
    boolean first = true;
    for (DependencyNode node : preorder) {
      Dependency d = node.getDependency();
      if (d == null || d.getArtifact() == null) {
        continue;
      }
      Artifact a = d.getArtifact();
      if ("pom".equalsIgnoreCase(a.getExtension())) {
        continue;
      }
      String dedupKey =
          a.getGroupId()
              + ":"
              + a.getArtifactId()
              + ":"
              + a.getBaseVersion()
              + ":"
              + a.getClassifier();
      if (!seen.add(dedupKey)) {
        continue;
      }

      boolean isDirect =
          directKeys.contains(a.getGroupId() + ":" + a.getArtifactId() + ":" + a.getClassifier());
      MavenProject sibling =
          reactorByGav.get(reactorKey(a.getGroupId(), a.getArtifactId(), a.getBaseVersion()));

      if (!first) {
        sb.append(",");
      }
      first = false;

      if (sibling != null) {
        sb.append("{");
        sb.append("\"group\":").append(jsonString(sibling.getGroupId())).append(",");
        sb.append("\"name\":").append(jsonString(sibling.getArtifactId())).append(",");
        sb.append("\"version\":null,");
        sb.append("\"type\":\"project\",");
        sb.append("\"jarPath\":null,");
        sb.append("\"sourcesJarPath\":null,");
        sb.append("\"origin\":\"interproject\",");
        sb.append("\"direct\":").append(isDirect).append(",");
        sb.append("\"interproject\":{");
        sb.append("\"moduleName\":").append(jsonString(sibling.getArtifactId())).append(",");
        sb.append("\"modulePath\":")
            .append(jsonString(sibling.getBasedir().getAbsolutePath()));
        sb.append("}}");
      } else if ("system".equals(d.getScope())) {
        File sysFile = a.getFile();
        if (sysFile == null) {
          String localPath = a.getProperty("localPath", null);
          if (localPath != null && !localPath.isEmpty()) {
            sysFile = new File(localPath);
          }
        }
        String groupOut =
            a.getGroupId() != null && !a.getGroupId().trim().isEmpty()
                ? a.getGroupId().trim()
                : "_local";
        String verOut =
            a.getVersion() != null && !a.getVersion().trim().isEmpty()
                ? a.getVersion().trim()
                : null;
        sb.append("{");
        sb.append("\"group\":").append(jsonString(groupOut)).append(",");
        sb.append("\"name\":").append(jsonString(a.getArtifactId())).append(",");
        sb.append("\"version\":").append(jsonStringOrNull(verOut)).append(",");
        sb.append("\"type\":\"local-file\",");
        sb.append("\"jarPath\":")
            .append(jsonStringOrNull(sysFile != null ? sysFile.getAbsolutePath() : null))
            .append(",");
        sb.append("\"sourcesJarPath\":null,");
        sb.append("\"origin\":\"local-file\",");
        sb.append("\"direct\":").append(isDirect);
        sb.append("}");
      } else {
        File jarFile = a.getFile();
        String jarPath = jarFile != null ? jarFile.getAbsolutePath() : null;
        String sourcesJarPath = adjacentSourcesJarPathOrNull(jarFile, a.getClassifier());
        sb.append("{");
        sb.append("\"group\":").append(jsonString(a.getGroupId())).append(",");
        sb.append("\"name\":").append(jsonString(a.getArtifactId())).append(",");
        sb.append("\"version\":").append(jsonStringOrNull(a.getBaseVersion())).append(",");
        sb.append("\"type\":\"jar\",");
        sb.append("\"jarPath\":").append(jsonStringOrNull(jarPath)).append(",");
        sb.append("\"sourcesJarPath\":").append(jsonStringOrNull(sourcesJarPath)).append(",");
        sb.append("\"origin\":\"external\",");
        sb.append("\"direct\":").append(isDirect);
        sb.append("}");
      }
    }

    sb.append("]}");
  }

  private String adjacentSourcesJarPathOrNull(File jarFile, String classifier) {
    if (jarFile == null || (classifier != null && !classifier.isEmpty())) {
      return null;
    }
    String name = jarFile.getName();
    if (!name.endsWith(".jar")) {
      return null;
    }
    String stem = name.substring(0, name.length() - 4);
    File candidate = new File(jarFile.getParentFile(), stem + "-sources.jar");
    return candidate.isFile() ? candidate.getAbsolutePath() : null;
  }

  private void collectPreorder(DependencyNode node, List<DependencyNode> out) {
    for (DependencyNode child : node.getChildren()) {
      out.add(child);
      collectPreorder(child, out);
    }
  }

  private String reactorKey(String group, String artifact, String version) {
    return (group != null ? group : "")
        + ":"
        + (artifact != null ? artifact : "")
        + ":"
        + (version != null ? version : "");
  }

  private Integer detectToolchainMajorOrNull(List<MavenProject> projects) {
    if (projects == null) {
      return null;
    }
    for (MavenProject p : projects) {
      Integer fromProps = readCompilerMajorFromPropertiesOrNull(p.getProperties());
      if (fromProps != null) {
        return fromProps;
      }
      Integer fromPlugin = readCompilerMajorFromPluginsOrNull(p);
      if (fromPlugin != null) {
        return fromPlugin;
      }
    }
    return null;
  }

  private Integer readCompilerMajorFromPropertiesOrNull(Properties props) {
    if (props == null) {
      return null;
    }
    String[] keys = {
      "maven.compiler.release",
      "maven.compiler.source",
      "maven.compiler.target",
      "java.version"
    };
    for (String key : keys) {
      Integer parsed = parseJavaMajorOrNull(props.getProperty(key));
      if (parsed != null) {
        return parsed;
      }
    }
    return null;
  }

  private Integer readCompilerMajorFromPluginsOrNull(MavenProject project) {
    if (project.getBuild() == null || project.getBuild().getPlugins() == null) {
      return null;
    }
    for (Plugin plugin : project.getBuild().getPlugins()) {
      if (!"maven-compiler-plugin".equals(plugin.getArtifactId())) {
        continue;
      }
      Object cfg = plugin.getConfiguration();
      if (cfg == null) {
        continue;
      }
      String xml = cfg.toString();
      Matcher releaseMatcher = XML_RELEASE_TAG.matcher(xml);
      if (releaseMatcher.find()) {
        Integer parsed = parseJavaMajorOrNull(releaseMatcher.group(1));
        if (parsed != null) {
          return parsed;
        }
      }
      Matcher sourceMatcher = XML_SOURCE_TAG.matcher(xml);
      if (sourceMatcher.find()) {
        Integer parsed = parseJavaMajorOrNull(sourceMatcher.group(1));
        if (parsed != null) {
          return parsed;
        }
      }
    }
    return null;
  }

  private Integer parseJavaMajorOrNull(String raw) {
    if (raw == null) {
      return null;
    }
    String s = raw.trim();
    if (s.isEmpty()) {
      return null;
    }
    if (s.startsWith("1.")) {
      s = s.substring(2);
    }
    int dot = s.indexOf('.');
    if (dot > 0) {
      s = s.substring(0, dot);
    }
    try {
      int v = Integer.parseInt(s);
      return v > 0 ? Integer.valueOf(v) : null;
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  private String detectMavenVersion(MavenSession session) {
    String sysProp = session.getSystemProperties().getProperty("maven.version");
    if (sysProp != null && !sysProp.trim().isEmpty()) {
      return sysProp.trim();
    }
    InputStream in =
        MavenSession.class.getResourceAsStream(
            "/META-INF/maven/org.apache.maven/maven-core/pom.properties");
    if (in != null) {
      try {
        Properties props = new Properties();
        props.load(in);
        String v = props.getProperty("version");
        if (v != null && !v.trim().isEmpty()) {
          return v.trim();
        }
      } catch (IOException ignored) {
        // Ignore and fall back.
      } finally {
        try {
          in.close();
        } catch (IOException ignored) {
          // Ignore.
        }
      }
    }
    return "unknown";
  }

  private void emitOutput(String json) throws IOException {
    String outputFile = System.getProperty("jvmsrc.outputFile", "").trim();
    if (!outputFile.isEmpty()) {
      Files.write(new File(outputFile).toPath(), (json + "\n").getBytes(StandardCharsets.UTF_8));
    } else {
      System.out.println(json);
      System.out.flush();
    }
  }

  private String jsonStringOrNull(String value) {
    return value == null ? "null" : jsonString(value);
  }

  private String jsonString(String value) {
    StringBuilder sb = new StringBuilder(value.length() + 4);
    sb.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\b':
          sb.append("\\b");
          break;
        case '\f':
          sb.append("\\f");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        default:
          if (c < 0x20) {
            sb.append(String.format("\\u%04x", Integer.valueOf((int) c)));
          } else {
            sb.append(c);
          }
          break;
      }
    }
    sb.append('"');
    return sb.toString();
  }
}
