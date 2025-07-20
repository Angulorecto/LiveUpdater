package com.angulorecto.LiveUpdater.pluginmgr;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.Plugin;

import java.util.List;
import java.util.Map;

public interface PluginManager {

    void enable(Plugin plugin);

    void disable(Plugin plugin);

    void reload(Plugin plugin);

    void reloadAll();

    String unload(Plugin plugin);

    String load(String name);

    Plugin getPluginByName(String name);

    List<String> getPluginNames(boolean fullName);

    List<String> getEnabledPluginNames(boolean fullName);

    List<String> getDisabledPluginNames(boolean fullName);

    Map<String, Command> getKnownCommands();

    void setKnownCommands(Map<String, Command> knownCommands);
}