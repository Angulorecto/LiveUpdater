package com.angulorecto.LiveUpdater.pluginmgr;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.SimpleCommandMap;
import org.bukkit.plugin.InvalidDescriptionException;
import org.bukkit.plugin.InvalidPluginException;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.lang.reflect.Field;
import java.util.*;

public class SimplePluginManager implements PluginManager {

    private final JavaPlugin loader;

    public SimplePluginManager(JavaPlugin loader) {
        this.loader = loader;
    }

    @Override
    public void enable(Plugin plugin) {
        Bukkit.getPluginManager().enablePlugin(plugin);
    }

    @Override
    public void disable(Plugin plugin) {
        Bukkit.getPluginManager().disablePlugin(plugin);
    }

    @Override
    public void reload(Plugin plugin) {
        disable(plugin);
        unload(plugin);
        load(plugin.getName());
    }

    @Override
    public void reloadAll() {
        for (Plugin plugin : Bukkit.getPluginManager().getPlugins()) {
            reload(plugin);
        }
    }

    @Override
    public String unload(Plugin plugin) {
        String name = plugin.getName();

        // 1. Disable plugin
        Bukkit.getPluginManager().disablePlugin(plugin);

        // 2. Cancel tasks
        Bukkit.getScheduler().cancelTasks(plugin);

        // 3. Unregister listeners
        try {
            Field field = Bukkit.getPluginManager().getClass().getDeclaredField("listeners");
            field.setAccessible(true);
            Map<?, ?> listeners = (Map<?, ?>) field.get(Bukkit.getPluginManager());
            listeners.remove(plugin);
        } catch (Exception ignored) {}

        // 4. Remove plugin commands
        Map<String, Command> knownCommands = getKnownCommands();
        knownCommands.entrySet().removeIf(entry -> {
            Command command = entry.getValue();
            Plugin owner = Bukkit.getPluginCommand(entry.getKey()).getPlugin();
            return owner != null && owner.equals(plugin);
        });

        setKnownCommands(knownCommands);

        // 5. Remove from plugin manager
        try {
            Field pluginsField = Bukkit.getPluginManager().getClass().getDeclaredField("plugins");
            Field lookupNamesField = Bukkit.getPluginManager().getClass().getDeclaredField("lookupNames");
            pluginsField.setAccessible(true);
            lookupNamesField.setAccessible(true);

            List<Plugin> plugins = (List<Plugin>) pluginsField.get(Bukkit.getPluginManager());
            Map<String, Plugin> names = (Map<String, Plugin>) lookupNamesField.get(Bukkit.getPluginManager());

            plugins.remove(plugin);
            names.remove(name);
        } catch (Exception ignored) {}

        // 6. Close class loader
        try {
            ClassLoader cl = plugin.getClass().getClassLoader();
            if (cl instanceof java.net.URLClassLoader) {
                ((java.net.URLClassLoader) cl).close();
            }
        } catch (Exception ignored) {}

        return "Unloaded " + name;
    }

    @Override
    public String load(String name) {
        File pluginDir = new File("plugins");
        if (!pluginDir.isDirectory()) return "Plugin directory not found";

        File[] files = pluginDir.listFiles((dir, fileName) -> fileName.toLowerCase().endsWith(".jar"));
        if (files == null) return "No plugin files found";

        for (File file : files) {
            try {
                Plugin target = Bukkit.getPluginManager().loadPlugin(file);
                if (target.getName().equalsIgnoreCase(name)) {
                    target.onLoad();
                    Bukkit.getPluginManager().enablePlugin(target);
                    return "Loaded plugin: " + name;
                }
            } catch (InvalidPluginException | InvalidDescriptionException ignored) {}
        }

        return "Could not find plugin: " + name;
    }

    @Override
    public Plugin getPluginByName(String name) {
        return Bukkit.getPluginManager().getPlugin(name);
    }

    @Override
    public List<String> getPluginNames(boolean fullName) {
        List<String> names = new ArrayList<>();
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
            names.add(fullName ? p.getDescription().getFullName() : p.getName());
        }
        return names;
    }

    @Override
    public List<String> getEnabledPluginNames(boolean fullName) {
        List<String> names = new ArrayList<>();
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
            if (p.isEnabled()) {
                names.add(fullName ? p.getDescription().getFullName() : p.getName());
            }
        }
        return names;
    }

    @Override
    public List<String> getDisabledPluginNames(boolean fullName) {
        List<String> names = new ArrayList<>();
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
            if (!p.isEnabled()) {
                names.add(fullName ? p.getDescription().getFullName() : p.getName());
            }
        }
        return names;
    }

    @Override
    public Map<String, Command> getKnownCommands() {
        try {
            Field commandMapField = Bukkit.getServer().getClass().getDeclaredField("commandMap");
            commandMapField.setAccessible(true);
            SimpleCommandMap map = (SimpleCommandMap) commandMapField.get(Bukkit.getServer());

            Field knownCommandsField = SimpleCommandMap.class.getDeclaredField("knownCommands");
            knownCommandsField.setAccessible(true);
            return (Map<String, Command>) knownCommandsField.get(map);
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch known commands", e);
        }
    }

    @Override
    public void setKnownCommands(Map<String, Command> knownCommands) {
        try {
            Field commandMapField = Bukkit.getServer().getClass().getDeclaredField("commandMap");
            commandMapField.setAccessible(true);
            SimpleCommandMap map = (SimpleCommandMap) commandMapField.get(Bukkit.getServer());

            Field knownCommandsField = SimpleCommandMap.class.getDeclaredField("knownCommands");
            knownCommandsField.setAccessible(true);
            knownCommandsField.set(map, knownCommands);
        } catch (Exception e) {
            throw new RuntimeException("Failed to set known commands", e);
        }
    }
}