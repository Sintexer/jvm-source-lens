package example;

import org.gradle.api.Plugin;
import org.gradle.api.Project;

public class PickerPlugin implements Plugin<Project> {
    static final String JAR = "liba";

    @Override
    public void apply(Project project) {
        project.getRepositories().flatDir(repo -> repo.dirs("libs"));
        java.util.Map<String, String> notation = new java.util.HashMap<>();
        notation.put("name", JAR);
        project.getDependencies().add("implementation", notation);
    }
}
